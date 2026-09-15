import { afterEach, describe, expect, it, vi } from 'vitest';

import { PayoutEngine, type SettleResult } from '../src/contracts/clients.js';
import type { SettlementStatus, TriggerEvaluation } from '../src/contracts/types.js';
import { AppError } from '../src/errors.js';
import { SettlementKeeper, type KeeperLogger } from '../src/keeper/keeper.js';
import { contractAddress } from './helpers/env.js';
import { FakeGateway } from './helpers/fakes.js';
import { recordingLogger, silentLogger } from './helpers/loggers.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function evaluation(policyId: bigint, status: SettlementStatus): TriggerEvaluation {
  const paid = status === 'Paid';
  return {
    policyId,
    status,
    indexValue: paid ? 120n : 0n,
    readingTimestamp: paid ? 1_700_000_000n : 0n,
    payoutAmount: paid ? 4_000n : 0n,
  };
}

function settleResult(policyId: bigint, status: SettlementStatus): SettleResult {
  return {
    hash: `hash-${policyId.toString()}`,
    ledger: 42,
    outcome: {
      policyId,
      status,
      indexValue: 120n,
      readingTimestamp: 1_700_000_000n,
      paidAmount: status === 'Paid' ? 4_000n : 0n,
    },
  };
}

class FakeRegistry {
  count = 0n;
  countError: unknown;

  async policyCount(): Promise<bigint> {
    if (this.countError !== undefined) throw this.countError;
    return this.count;
  }
}

class FakeEngine {
  readonly evaluated: bigint[] = [];
  readonly settled: bigint[] = [];

  constructor(
    private readonly evaluations: Map<bigint, TriggerEvaluation | Error>,
    private readonly settlements: Map<bigint, SettleResult | Error>,
  ) {}

  async evaluate(policyId: bigint): Promise<TriggerEvaluation> {
    this.evaluated.push(policyId);
    const scripted = this.evaluations.get(policyId);
    if (scripted === undefined) throw new Error(`no evaluation scripted for ${policyId}`);
    if (scripted instanceof Error) throw scripted;
    return scripted;
  }

  async settlePolicy(policyId: bigint): Promise<SettleResult> {
    this.settled.push(policyId);
    const scripted = this.settlements.get(policyId);
    if (scripted === undefined) throw new Error(`no settlement scripted for ${policyId}`);
    if (scripted instanceof Error) throw scripted;
    return scripted;
  }
}

interface Harness {
  readonly keeper: SettlementKeeper;
  readonly registry: FakeRegistry;
  readonly engine: FakeEngine;
}

function harness(options: {
  count: bigint;
  evaluations: Array<[bigint, TriggerEvaluation | Error]>;
  settlements?: Array<[bigint, SettleResult | Error]>;
  batchSize?: number;
  intervalMs?: number;
  logger?: KeeperLogger;
}): Harness {
  const registry = new FakeRegistry();
  registry.count = options.count;
  const engine = new FakeEngine(new Map(options.evaluations), new Map(options.settlements ?? []));
  const keeper = new SettlementKeeper({
    registry,
    engine,
    intervalMs: options.intervalMs ?? 1_000,
    batchSize: options.batchSize ?? 10,
    logger: options.logger ?? silentLogger,
    now: () => 1_000,
  });
  return { keeper, registry, engine };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Deciding what to do
// ---------------------------------------------------------------------------

describe('sweeping', () => {
  it('submits nothing while cover is still open', async () => {
    const { keeper, engine } = harness({
      count: 2n,
      evaluations: [
        [1n, evaluation(1n, 'Pending')],
        [2n, evaluation(2n, 'Pending')],
      ],
    });

    const report = await keeper.sweep();

    expect(report.considered).toBe(2);
    expect(report.settled).toBe(0);
    expect(report.expired).toBe(0);
    expect(report.failed).toBe(0);
    // The whole point of previewing first: a sweep with nothing due costs no
    // transactions.
    expect(engine.settled).toEqual([]);
    expect(report.entries.map((item) => item.action)).toEqual(['skipped', 'skipped']);
  });

  it('settles a policy the index has triggered', async () => {
    const { keeper, engine } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Paid')]],
      settlements: [[1n, settleResult(1n, 'Paid')]],
    });

    const report = await keeper.sweep();

    expect(engine.settled).toEqual([1n]);
    expect(report.settled).toBe(1);
    expect(report.entries[0]).toMatchObject({
      policyId: 1n,
      action: 'settled',
      status: 'Paid',
      transactionHash: 'hash-1',
    });
  });

  it('expires a window that closed without a breach', async () => {
    const { keeper, engine } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Expired')]],
      settlements: [[1n, settleResult(1n, 'Expired')]],
    });

    const report = await keeper.sweep();

    // Expiry is housekeeping worth doing: it releases the pool's liability.
    expect(engine.settled).toEqual([1n]);
    expect(report.expired).toBe(1);
    expect(report.entries[0]).toMatchObject({ action: 'expired', status: 'Expired' });
  });

  it('does not report a settlement that left the policy pending as an expiry', async () => {
    // `settle_policy` answers with the status it acted on. Expiry is not the
    // only alternative to a payout, so a non-`Paid` outcome must not be read as
    // "cover lapsed" — this status cannot come back from a sweep today, and the
    // mapping is explicit so that it stays correct if one ever does.
    const pending = settleResult(1n, 'Pending');
    const { keeper } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Paid')]],
      settlements: [[1n, pending]],
    });

    const report = await keeper.sweep();

    expect(report.expired).toBe(0);
    expect(report.settled).toBe(0);
    expect(report.entries[0]).toMatchObject({ action: 'skipped', status: 'Pending' });
    expect(report.entries[0]?.reason).toContain('open');
  });

  it('treats a policy that already left the book as skipped, not failed', async () => {
    const { keeper, engine } = harness({
      count: 1n,
      evaluations: [[1n, new AppError(409, 'policy_not_active', 'already settled')]],
    });

    const report = await keeper.sweep();

    // Every settled policy would otherwise be reported as an incident forever.
    expect(report.entries[0]).toMatchObject({ action: 'skipped', reason: 'policy_not_active' });
    expect(report.failed).toBe(0);
    expect(engine.settled).toEqual([]);
  });

  it('reports an evaluation failure without submitting anything', async () => {
    const { keeper, engine } = harness({
      count: 1n,
      evaluations: [[1n, new Error('node unavailable')]],
    });

    const report = await keeper.sweep();

    expect(report.failed).toBe(1);
    expect(report.entries[0]).toMatchObject({ action: 'failed', reason: 'node unavailable' });
    expect(engine.settled).toEqual([]);
  });

  it('leaves a policy for the next sweep when submission fails', async () => {
    const { keeper, engine } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Paid')]],
      settlements: [[1n, new Error('transaction failed')]],
    });

    const report = await keeper.sweep();

    // The policy is still Active on chain, so the next pass retries it — the
    // loop is the retry.
    expect(report.failed).toBe(1);
    expect(report.entries[0]).toMatchObject({ action: 'failed', status: 'Paid' });
    expect(engine.settled).toEqual([1n]);
  });

  it('ends quietly when the policy count cannot be read', async () => {
    const failing = harness({ count: 3n, evaluations: [] });
    failing.registry.countError = new Error('rpc down');

    const report = await failing.keeper.sweep();

    // A sweep that cannot even start is reported, not thrown: the next tick
    // tries again, so one bad round trip must not take the keeper down.
    expect(report.considered).toBe(0);
    expect(report.failed).toBe(0);
    expect(failing.engine.evaluated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The closing instant
// ---------------------------------------------------------------------------

/** An `evaluate` verdict exactly as `scValToNative` would hand it over. */
function wireEvaluation(status: number): Record<string, unknown> {
  return {
    policy_id: 1n,
    status,
    index_value: 0n,
    reading_timestamp: 0n,
    payout_amount: 0n,
  };
}

/** A `settle_policy` outcome exactly as the node reports it. */
function wireOutcome(status: number): Record<string, unknown> {
  return {
    policy_id: 1n,
    status,
    index_value: 0n,
    reading_timestamp: 0n,
    paid_amount: 0n,
  };
}

/**
 * A keeper reading the engine through its real client, over a scripted node.
 *
 * The rest of this suite stubs the engine, which is right for the sweep logic
 * but cannot catch a verdict that arrives through the decoder. Here the wire
 * value is what decides, so a status mapped onto the wrong discriminant shows
 * up as a wrong action rather than as a stubbed answer that was already right.
 */
function realClientKeeper(gateway: FakeGateway): SettlementKeeper {
  return new SettlementKeeper({
    registry: { policyCount: async () => 1n },
    engine: new PayoutEngine(gateway, contractAddress()),
    intervalMs: 1_000,
    batchSize: 10,
    logger: silentLogger,
    now: () => 1_000,
  });
}

describe('a policy at its closing instant', () => {
  it('skips it rather than submitting an expiry', async () => {
    // At exactly `coverage_end` the engine keeps the window open — the closing
    // instant is not covered, but the window has not lapsed either — so
    // `evaluate` answers `Pending` (discriminant 2), and the registry refuses
    // `expire_policy` for that same second. Submitting here can only ever
    // produce a failed sweep, so the keeper has to read it as "nothing to do".
    const gateway = new FakeGateway().withRead('evaluate', wireEvaluation(2));

    const report = await realClientKeeper(gateway).sweep();

    expect(report.entries[0]).toMatchObject({
      policyId: 1n,
      action: 'skipped',
      status: 'Pending',
    });
    expect(report.settled).toBe(0);
    expect(report.expired).toBe(0);
    expect(report.failed).toBe(0);
    expect(gateway.writes).toEqual([]);
  });

  it('submits the expiry once the clock is a second past the window', async () => {
    // The same policy one second later, where `evaluate` answers `Expired`
    // (discriminant 1). Expiry releases the pool's liability, so it is worth a
    // transaction — which is what makes the skip above a decision about the
    // clock rather than an inability to submit.
    const gateway = new FakeGateway()
      .withRead('evaluate', wireEvaluation(1))
      .withWrite('settle_policy', { hash: 'hash-1', ledger: 42, returnValue: wireOutcome(1) });

    const report = await realClientKeeper(gateway).sweep();

    expect(gateway.writes[0]).toMatchObject({
      method: 'settle_policy',
      args: [{ type: 'u64', value: 1n }],
    });
    expect(report.entries[0]).toMatchObject({ action: 'expired', status: 'Expired' });
    expect(report.expired).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Coverage of the book
// ---------------------------------------------------------------------------

describe('cursor', () => {
  it('covers the whole book over successive sweeps and wraps around', async () => {
    const evaluations: Array<[bigint, TriggerEvaluation]> = [];
    for (let id = 1n; id <= 5n; id += 1n) evaluations.push([id, evaluation(id, 'Pending')]);

    const { keeper, engine } = harness({ count: 5n, evaluations, batchSize: 2 });

    await keeper.sweep();
    await keeper.sweep();
    await keeper.sweep();

    expect(engine.evaluated).toEqual([1n, 2n, 3n, 4n, 5n, 1n]);
  });

  it('never walks past the newest policy', async () => {
    const { keeper, engine } = harness({
      count: 2n,
      evaluations: [
        [1n, evaluation(1n, 'Pending')],
        [2n, evaluation(2n, 'Pending')],
      ],
      batchSize: 5,
    });

    await keeper.sweep();

    // A batch larger than the book must not fabricate ids.
    expect(engine.evaluated).toEqual([1n, 2n]);
  });

  it('does nothing at all on an empty book', async () => {
    const { keeper, engine } = harness({ count: 0n, evaluations: [] });

    const report = await keeper.sweep();

    expect(report.considered).toBe(0);
    expect(engine.evaluated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

describe('logging', () => {
  it('stays quiet when nothing is due', async () => {
    const logger = recordingLogger();
    const { keeper } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Pending')]],
      logger,
    });

    await keeper.sweep();

    // A healthy book is swept every interval; if each pass logged, the noise
    // would be exactly what hides the passes that matter.
    expect(logger.infoCalls).toEqual([]);
    expect(logger.warnCalls).toEqual([]);
    expect(logger.errorCalls).toEqual([]);
  });

  it('warns about a policy it could not settle, naming the policy', async () => {
    const logger = recordingLogger();
    const { keeper } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Paid')]],
      settlements: [[1n, new Error('transaction failed')]],
      logger,
    });

    await keeper.sweep();

    expect(logger.warnCalls).toHaveLength(1);
    expect(logger.warnCalls[0]).toMatchObject({ policyId: 1n, status: 'Paid' });
  });

  it('reports a sweep that moved money', async () => {
    const logger = recordingLogger();
    const { keeper } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Paid')]],
      settlements: [[1n, settleResult(1n, 'Paid')]],
      logger,
    });

    await keeper.sweep();

    expect(logger.infoCalls).toHaveLength(1);
    expect(logger.infoCalls[0]).toMatchObject({ settled: 1 });
  });
});

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

describe('the loop', () => {
  it('starts idempotently and stops without sweeping again', async () => {
    vi.useFakeTimers();
    const { keeper, engine } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Pending')]],
      intervalMs: 1_000,
    });

    keeper.start();
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(keeper.status().running).toBe(true);
    expect(engine.evaluated).toEqual([1n]);

    await keeper.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(keeper.status().running).toBe(false);
    expect(engine.evaluated).toEqual([1n]);
  });

  it('skips a tick while the previous sweep is still running', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let evaluateCalls = 0;
    const registry = { policyCount: async (): Promise<bigint> => 1n };
    const engine = {
      evaluate: async (policyId: bigint): Promise<TriggerEvaluation> => {
        evaluateCalls += 1;
        await gate;
        return evaluation(policyId, 'Pending');
      },
      settlePolicy: async (): Promise<never> => {
        throw new Error('nothing should be submitted in this test');
      },
    };
    const keeper = new SettlementKeeper({
      registry,
      engine,
      intervalMs: 100,
      batchSize: 1,
      logger: silentLogger,
      now: () => 0,
    });

    keeper.start();
    await vi.advanceTimersByTimeAsync(100);
    // Several more ticks fire while the first sweep is still blocked.
    await vi.advanceTimersByTimeAsync(1_000);

    expect(evaluateCalls).toBe(1);
    expect(keeper.status().lastSweep).toBeUndefined();

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    await keeper.stop();

    expect(keeper.status().lastSweep).toBeDefined();
  });

  it('keeps running after a sweep fails outright', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const registry = {
      policyCount: async (): Promise<bigint> => {
        calls += 1;
        if (calls === 1) throw new Error('rpc down');
        return 0n;
      },
    };
    const engine = {
      evaluate: async (): Promise<never> => {
        throw new Error('unused');
      },
      settlePolicy: async (): Promise<never> => {
        throw new Error('unused');
      },
    };
    const keeper = new SettlementKeeper({
      registry,
      engine,
      intervalMs: 100,
      batchSize: 1,
      logger: silentLogger,
      now: () => 0,
    });

    keeper.start();
    await vi.advanceTimersByTimeAsync(300);
    await keeper.stop();

    expect(calls).toBeGreaterThan(1);
  });

  it('accumulates totals across sweeps', async () => {
    const { keeper } = harness({
      count: 1n,
      evaluations: [[1n, evaluation(1n, 'Paid')]],
      settlements: [[1n, settleResult(1n, 'Paid')]],
    });

    await keeper.sweep();
    await keeper.sweep();

    expect(keeper.status().totals).toEqual({ swept: 2, settled: 2, expired: 0, failed: 0 });
  });
});
