/**
 * The settlement keeper.
 *
 * Settlement is permissionless on chain: the registry and the pool each check
 * that the *calling contract* is their registered engine, and nothing else. That
 * makes a claim pushable by anyone, and this loop is that "anyone": it walks the
 * book, asks the engine what each policy would do, and submits only the ones
 * that would actually change something.
 *
 * Three deliberate properties:
 *
 * * **It never guesses.** The decision comes from `evaluate`, the same read-only
 *   entry point the API exposes, which is backed by the same pure rule that
 *   on-chain settlement uses. A sweep with nothing due costs one simulation per
 *   policy and submits nothing — no wasted fees.
 * * **It submits one at a time.** Transactions from a single keeper account are
 *   ordered by sequence number, so firing them off concurrently produces
 *   sequence conflicts rather than speed.
 * * **It never overlaps.** A sweep still running makes the next tick a no-op, so
 *   a slow RPC node cannot multiply submissions.
 *
 * The loop is itself the retry: a policy that fails this sweep is still `Active`
 * in the registry and is picked up again on a later pass. There is no in-sweep
 * retry, because re-submitting within one sweep would only add duplicate
 * sequence churn.
 */

import type { PayoutEngine, PolicyRegistry, SettleResult } from '../contracts/clients.js';
import type { SettlementStatus } from '../contracts/types.js';
import { AppError, describeError } from '../errors.js';

/** What the keeper did with one policy during one sweep. */
export type SweepAction = 'settled' | 'expired' | 'skipped' | 'failed';

export interface SweepEntry {
  readonly policyId: bigint;
  readonly action: SweepAction;
  /** The engine's verdict, when it produced one. */
  readonly status: SettlementStatus | undefined;
  readonly transactionHash: string | undefined;
  readonly reason: string | undefined;
}

export interface SweepReport {
  readonly startedAt: number;
  readonly finishedAt: number;
  /** Policies examined in this sweep. */
  readonly considered: number;
  readonly settled: number;
  readonly expired: number;
  readonly failed: number;
  readonly entries: readonly SweepEntry[];
}

export interface KeeperTotals {
  readonly swept: number;
  readonly settled: number;
  readonly expired: number;
  readonly failed: number;
}

export interface KeeperStatus {
  readonly running: boolean;
  /** Next policy id the sweep will start from. */
  readonly cursor: bigint;
  readonly totals: KeeperTotals;
  readonly lastSweep: SweepReport | undefined;
}

/** The subset of a logger the keeper uses. */
export interface KeeperLogger {
  info(payload: object, message: string): void;
  warn(payload: object, message: string): void;
  error(payload: object, message: string): void;
}

/** Only the registry and engine behaviour the keeper needs, so tests can stub it. */
export type KeeperRegistry = Pick<PolicyRegistry, 'policyCount'>;
export type KeeperEngine = Pick<PayoutEngine, 'evaluate' | 'settlePolicy'>;

export interface KeeperOptions {
  readonly registry: KeeperRegistry;
  readonly engine: KeeperEngine;
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly logger: KeeperLogger;
  /** Injected so a test can pin the report's timestamps. */
  readonly now?: (() => number) | undefined;
}

export class SettlementKeeper {
  private readonly registry: KeeperRegistry;
  private readonly engine: KeeperEngine;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly logger: KeeperLogger;
  private readonly now: () => number;

  /** Next policy id to start a sweep from; wraps at the newest. */
  private cursor = 1n;
  private timer: NodeJS.Timeout | undefined;
  /** The sweep in progress, whatever it eventually resolves to. */
  private inFlight: Promise<unknown> | undefined;
  private lastSweep: SweepReport | undefined;
  private totals: KeeperTotals = { swept: 0, settled: 0, expired: 0, failed: 0 };

  constructor(options: KeeperOptions) {
    this.registry = options.registry;
    this.engine = options.engine;
    this.intervalMs = options.intervalMs;
    this.batchSize = options.batchSize;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
  }

  /** Starts the periodic sweep. Idempotent. */
  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.logger.info({ intervalMs: this.intervalMs }, 'settlement keeper started');
  }

  /**
   * Stops sweeping and waits for the sweep already running, so shutdown does not
   * cut a transaction off mid-flight.
   */
  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger.info({}, 'settlement keeper stopped');
    }
    const pending = this.inFlight;
    if (pending !== undefined) await pending;
  }

  status(): KeeperStatus {
    return {
      running: this.timer !== undefined,
      cursor: this.cursor,
      totals: this.totals,
      lastSweep: this.lastSweep,
    };
  }

  /**
   * Runs one sweep to completion.
   *
   * Exposed so an operator can trigger a pass on demand and so tests can drive
   * it without waiting on a timer.
   */
  async sweep(): Promise<SweepReport> {
    const startedAt = this.now();
    const entries: SweepEntry[] = [];

    let count: bigint;
    try {
      count = await this.registry.policyCount();
    } catch (cause) {
      // Without the policy count there is nothing to walk, and the next sweep
      // will try again.
      this.logger.error({ err: describeError(cause) }, 'keeper could not read the policy count');
      const failed: SweepReport = {
        startedAt,
        finishedAt: this.now(),
        considered: 0,
        settled: 0,
        expired: 0,
        failed: 0,
        entries,
      };
      this.lastSweep = failed;
      return failed;
    }

    for (const policyId of this.takeIds(count)) {
      entries.push(await this.process(policyId));
    }

    const report: SweepReport = {
      startedAt,
      finishedAt: this.now(),
      considered: entries.length,
      settled: tally(entries, 'settled'),
      expired: tally(entries, 'expired'),
      failed: tally(entries, 'failed'),
      entries,
    };

    this.lastSweep = report;
    this.totals = {
      swept: this.totals.swept + report.considered,
      settled: this.totals.settled + report.settled,
      expired: this.totals.expired + report.expired,
      failed: this.totals.failed + report.failed,
    };

    if (report.settled > 0 || report.expired > 0 || report.failed > 0) {
      this.logger.info(
        {
          considered: report.considered,
          settled: report.settled,
          expired: report.expired,
          failed: report.failed,
        },
        'settlement sweep finished',
      );
    }

    return report;
  }

  /**
   * Selects the next slice of policy ids and advances the cursor.
   *
   * The cursor sweeps forward from the oldest policy and wraps at the newest, so
   * successive passes cover the whole book without needing a database to
   * remember where the last one stopped. A book large enough for that to be too
   * slow wants an index rather than a bigger batch.
   *
   * A batch never exceeds the book: asking for more than exists would otherwise
   * wrap and examine the same policies twice in one pass, which is both wasted
   * work and a surprising report.
   */
  private takeIds(count: bigint): bigint[] {
    if (count < 1n) return [];

    const requested = BigInt(this.batchSize);
    const take = count < requested ? count : requested;

    const ids: bigint[] = [];
    let id = this.cursor > count ? 1n : this.cursor;
    for (let taken = 0n; taken < take; taken += 1n) {
      ids.push(id);
      id = id >= count ? 1n : id + 1n;
    }
    this.cursor = id;
    return ids;
  }

  private async process(policyId: bigint): Promise<SweepEntry> {
    let status: SettlementStatus;
    try {
      status = (await this.engine.evaluate(policyId)).status;
    } catch (cause) {
      // A policy that has already settled, expired or been cancelled is the
      // normal end state of the book, not an incident worth waking anyone for.
      if (cause instanceof AppError && (cause.code === 'policy_not_active' || cause.code === 'policy_not_found')) {
        return entry(policyId, 'skipped', undefined, undefined, cause.code);
      }
      this.logger.warn({ policyId, err: describeError(cause) }, 'keeper could not evaluate a policy');
      return entry(policyId, 'failed', undefined, undefined, describeError(cause));
    }

    if (status === 'Pending') {
      // Cover is still open and nothing has breached yet. This is the common
      // case, so it is not logged.
      return entry(policyId, 'skipped', status, undefined, undefined);
    }

    try {
      const result = await this.engine.settlePolicy(policyId);
      return this.classify(policyId, result);
    } catch (cause) {
      // Still Active on chain, so a later sweep picks it up again.
      this.logger.warn(
        { policyId, status, err: describeError(cause) },
        'keeper could not settle a policy',
      );
      return entry(policyId, 'failed', status, undefined, describeError(cause));
    }
  }

  /**
   * Reads a settlement the chain accepted as a sweep action.
   *
   * Every status is named rather than inferred from "anything but Paid means the
   * cover lapsed": the two are the same today, but they stop being the same the
   * moment the engine grows a status, and the difference is whether the report
   * claims money moved. The `default` branch assigns to `never`, so adding a
   * status to [`SettlementStatus`] fails the build here instead of quietly
   * landing in whichever bucket the ternary happened to fall through to.
   */
  private classify(policyId: bigint, result: SettleResult): SweepEntry {
    const outcome = result.outcome.status;

    switch (outcome) {
      case 'Paid':
        return entry(policyId, 'settled', outcome, result.hash, undefined);
      case 'Expired':
        return entry(policyId, 'expired', outcome, result.hash, undefined);
      case 'Pending':
        // Unreachable from a sweep today: the keeper only submits a policy that
        // `evaluate` called due, and that decision cannot move backwards. It is
        // handled anyway because reporting it as an expiry would assert that
        // cover had lapsed when the chain said nothing had changed.
        this.logger.warn(
          { policyId, transactionHash: result.hash },
          'a settlement left the policy pending',
        );
        return entry(policyId, 'skipped', outcome, result.hash, 'cover is still open');
      default: {
        const unhandled: never = outcome;
        throw new Error(`unhandled settlement status ${String(unhandled)}`);
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.inFlight !== undefined) {
      this.logger.warn({}, 'previous sweep has not finished; skipping this tick');
      return;
    }

    const run = this.sweep();
    this.inFlight = run;
    try {
      await run;
    } catch (cause) {
      // `sweep` handles its own per-policy failures, so reaching here means
      // something outside them broke.
      this.logger.error({ err: describeError(cause) }, 'settlement sweep failed outright');
    } finally {
      this.inFlight = undefined;
    }
  }
}

function entry(
  policyId: bigint,
  action: SweepAction,
  status: SettlementStatus | undefined,
  transactionHash: string | undefined,
  reason: string | undefined,
): SweepEntry {
  return { policyId, action, status, transactionHash, reason };
}

function tally(entries: readonly SweepEntry[], action: SweepAction): number {
  return entries.filter((item) => item.action === action).length;
}

