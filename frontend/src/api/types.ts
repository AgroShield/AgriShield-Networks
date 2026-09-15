/**
 * The API's response shapes, as this app understands them.
 *
 * These mirror the backend's `serializers.ts` field for field, and the decoders
 * that build them are the only way a response becomes a domain value. Two things
 * are worth knowing about the wire format:
 *
 * * every on-chain integer (`u64`, `i128`) arrives as a **decimal string**,
 *   because it does not fit a JavaScript number and `JSON.stringify` cannot
 *   serialise a `bigint` at all;
 * * timestamps the backend produces itself — the sweep report's — stay numbers,
 *   because they are not chain data and never need the range.
 *
 * Nothing is converted on the way in. Amounts stay exact integer strings for as
 * long as possible and are only formatted at the point of display, so a value
 * cannot lose precision in a layer that was not thinking about it.
 */

import {
  count,
  flag,
  integer,
  integerValue,
  list,
  maybeCount,
  maybeText,
  nested,
  oneOf,
  record,
  text,
} from './shape';

/** Lifecycle of a policy, mirroring `policy_registry::PolicyStatus`. */
export const POLICY_STATUSES = ['Active', 'Settled', 'Expired', 'Cancelled'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** What a settlement attempt concluded, mirroring `payout_engine::SettlementStatus`. */
export const SETTLEMENT_STATUSES = ['Paid', 'Expired', 'Pending'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** How a health report reads its own condition. */
export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface Policy {
  readonly id: string;
  readonly farmer: string;
  /** `sha256` of the plot geometry, hex encoded. */
  readonly plotHash: string;
  readonly cropType: string;
  readonly regionId: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /** Index value at or below which the policy pays out. */
  readonly triggerThreshold: string;
  readonly payoutAmount: string;
  readonly premium: string;
  readonly status: PolicyStatus;
  readonly createdAt: string;
  /** Timestamp of the terminal status; `"0"` while the policy is active. */
  readonly settledAt: string;
}

export interface PolicyList {
  /** Every id the registry matched, oldest first. */
  readonly policyIds: string[];
  /** Total matched, which may exceed the number hydrated. */
  readonly total: number;
  /** The newest `limit` of them, fully hydrated. */
  readonly policies: Policy[];
}

/** Read-only preview of what settlement would do right now. */
export interface Evaluation {
  readonly policyId: string;
  readonly status: SettlementStatus;
  readonly indexValue: string;
  readonly readingTimestamp: string;
  /** What would be paid; `"0"` unless the status is `Paid`. */
  readonly payoutAmount: string;
}

export interface SettlementOutcome {
  readonly policyId: string;
  readonly status: SettlementStatus;
  readonly indexValue: string;
  readonly readingTimestamp: string;
  readonly paidAmount: string;
}

export interface SubmittedSettlement {
  readonly transactionHash: string;
  readonly ledger: number;
  readonly outcome: SettlementOutcome;
}

export interface SweepEntry {
  readonly policyId: string;
  readonly action: string;
  readonly status: string | null;
  readonly transactionHash: string | null;
  readonly reason: string | null;
}

export interface SweepReport {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly considered: number;
  readonly settled: number;
  readonly expired: number;
  readonly failed: number;
  readonly entries: SweepEntry[];
}

export interface KeeperTotals {
  readonly swept: number;
  readonly settled: number;
  readonly expired: number;
  readonly failed: number;
}

export interface KeeperStatus {
  /** Whether this deployment holds a key and may settle at all. */
  readonly enabled: boolean;
  readonly running: boolean;
  /** Next policy id the sweep will start from. */
  readonly cursor: string;
  readonly totals: KeeperTotals;
  readonly lastSweep: SweepReport | null;
}

/** The four contract ids this API was deployed against. */
export interface ContractAddresses {
  readonly registry: string;
  readonly engine: string;
  readonly pool: string;
  readonly oracle: string;
}

/** The contracts the engine is wired to on chain. */
export interface EngineContracts {
  readonly policyRegistry: string;
  readonly premiumPool: string;
  readonly oracle: string;
}

export interface Health {
  readonly status: HealthStatus;
  readonly network: string;
  /** Latest ledger the node reported, or null when it could not be reached. */
  readonly ledger: number | null;
  readonly contracts: ContractAddresses;
  /** Wiring read back from the engine, or null when it could not be read. */
  readonly onChain: EngineContracts | null;
  readonly keeper: { readonly enabled: boolean };
  readonly reason: string | null;
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

export function decodePolicy(raw: unknown): Policy {
  const what = 'policy';
  const value = record(raw, what);
  return {
    id: integer(value, 'id', what),
    farmer: text(value, 'farmer', what),
    plotHash: text(value, 'plotHash', what),
    cropType: text(value, 'cropType', what),
    regionId: text(value, 'regionId', what),
    coverageStart: integer(value, 'coverageStart', what),
    coverageEnd: integer(value, 'coverageEnd', what),
    triggerThreshold: integer(value, 'triggerThreshold', what),
    payoutAmount: integer(value, 'payoutAmount', what),
    premium: integer(value, 'premium', what),
    status: oneOf(value, 'status', what, POLICY_STATUSES),
    createdAt: integer(value, 'createdAt', what),
    settledAt: integer(value, 'settledAt', what),
  };
}

export function decodePolicyList(raw: unknown): PolicyList {
  const what = 'policy list';
  const value = record(raw, what);
  const policies = list(value, 'policies', what).map((entry) => decodePolicy(entry));
  return {
    policyIds: list(value, 'policyIds', what).map((entry, index) =>
      integerValue(entry, `${what}.policyIds[${index}]`),
    ),
    total: count(value, 'total', what),
    policies,
  };
}

export function decodeEvaluation(raw: unknown): Evaluation {
  const what = 'settlement preview';
  const value = record(raw, what);
  return {
    policyId: integer(value, 'policyId', what),
    status: oneOf(value, 'status', what, SETTLEMENT_STATUSES),
    indexValue: integer(value, 'indexValue', what),
    readingTimestamp: integer(value, 'readingTimestamp', what),
    payoutAmount: integer(value, 'payoutAmount', what),
  };
}

export function decodeSettlementOutcome(raw: unknown): SettlementOutcome {
  const what = 'settlement outcome';
  const value = record(raw, what);
  return {
    policyId: integer(value, 'policyId', what),
    status: oneOf(value, 'status', what, SETTLEMENT_STATUSES),
    indexValue: integer(value, 'indexValue', what),
    readingTimestamp: integer(value, 'readingTimestamp', what),
    paidAmount: integer(value, 'paidAmount', what),
  };
}

export function decodeSubmittedSettlement(raw: unknown): SubmittedSettlement {
  const what = 'settlement';
  const value = record(raw, what);
  return {
    transactionHash: text(value, 'transactionHash', what),
    ledger: count(value, 'ledger', what),
    outcome: decodeSettlementOutcome(value['outcome']),
  };
}

function decodeSweepEntry(raw: unknown): SweepEntry {
  const what = 'sweep entry';
  const value = record(raw, what);
  return {
    policyId: integer(value, 'policyId', what),
    action: text(value, 'action', what),
    status: maybeText(value, 'status', what),
    transactionHash: maybeText(value, 'transactionHash', what),
    reason: maybeText(value, 'reason', what),
  };
}

function decodeSweepReport(raw: unknown): SweepReport {
  const what = 'sweep report';
  const value = record(raw, what);
  return {
    startedAt: count(value, 'startedAt', what),
    finishedAt: count(value, 'finishedAt', what),
    considered: count(value, 'considered', what),
    settled: count(value, 'settled', what),
    expired: count(value, 'expired', what),
    failed: count(value, 'failed', what),
    entries: list(value, 'entries', what).map((entry) => decodeSweepEntry(entry)),
  };
}

export function decodeKeeperStatus(raw: unknown): KeeperStatus {
  const what = 'keeper status';
  const value = record(raw, what);
  const totals = record(value['totals'], `${what}.totals`);
  const lastSweep = nested(value, 'lastSweep', what);
  return {
    enabled: flag(value, 'enabled', what),
    running: flag(value, 'running', what),
    cursor: integer(value, 'cursor', what),
    totals: {
      swept: count(totals, 'swept', `${what}.totals`),
      settled: count(totals, 'settled', `${what}.totals`),
      expired: count(totals, 'expired', `${what}.totals`),
      failed: count(totals, 'failed', `${what}.totals`),
    },
    lastSweep: lastSweep === null ? null : decodeSweepReport(lastSweep),
  };
}

function decodeAddresses(raw: unknown, what: string): ContractAddresses {
  const value = record(raw, what);
  return {
    registry: text(value, 'registry', what),
    engine: text(value, 'engine', what),
    pool: text(value, 'pool', what),
    oracle: text(value, 'oracle', what),
  };
}

function decodeEngineContracts(raw: unknown): EngineContracts {
  const what = 'on-chain wiring';
  const value = record(raw, what);
  return {
    policyRegistry: text(value, 'policyRegistry', what),
    premiumPool: text(value, 'premiumPool', what),
    oracle: text(value, 'oracle', what),
  };
}

export function decodeHealth(raw: unknown): Health {
  const what = 'health report';
  const value = record(raw, what);
  const onChain = nested(value, 'onChain', what);
  const keeper = record(value['keeper'], `${what}.keeper`);
  return {
    status: oneOf(value, 'status', what, HEALTH_STATUSES),
    network: text(value, 'network', what),
    ledger: maybeCount(value, 'ledger', what),
    contracts: decodeAddresses(value['contracts'], `${what}.contracts`),
    onChain: onChain === null ? null : decodeEngineContracts(onChain),
    keeper: { enabled: flag(keeper, 'enabled', `${what}.keeper`) },
    reason: maybeText(value, 'reason', what),
  };
}

/**
 * Whether a response body is a health report at all.
 *
 * `/health` answers 503 for both "the node is unreachable" and "this process is
 * wired to different contracts than the engine", and in both cases the body is a
 * full report rather than the API's usual error envelope. Telling the two apart
 * is what lets the health endpoint keep its own status semantics without the
 * client mistaking a report for a failure.
 */
export function looksLikeHealth(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const status = (raw as Record<string, unknown>)['status'];
  return typeof status === 'string' && (HEALTH_STATUSES as readonly string[]).includes(status);
}
