/**
 * Domain types for the four contracts, and the decoders that build them.
 *
 * `scValToNative` returns a plain JavaScript value whose shape follows the Rust
 * types it came from:
 *
 * * `#[contracttype]` structs arrive as objects keyed by field name;
 * * `u64` and `i128` arrive as `bigint`, because they do not fit a JS number;
 * * `BytesN<32>` arrives as bytes;
 * * and — because every status enum in this system carries an explicit integer
 *   discriminant — an enum arrives as a *number*, not a name. Soroban decodes
 *   `#[contracttype]` enums as `ScVal::U32` exactly when all variants have an
 *   explicit discriminant, which is how the contracts declare them.
 *
 * The decoders therefore verify rather than trust. A contract redeploy that
 * renames a field or renumbers a discriminant should fail loudly at the edge,
 * not quietly turn a settled policy into an active one.
 */

/** Lifecycle of a policy, mirroring `policy_registry::PolicyStatus`. */
export type PolicyStatus = 'Active' | 'Settled' | 'Expired' | 'Cancelled';

/** What a settlement attempt concluded, mirroring `payout_engine::SettlementStatus`. */
export type SettlementStatus = 'Paid' | 'Expired' | 'Pending';

/**
 * Discriminant tables. These are positional on purpose: the wire value is the
 * discriminant, so the only way to add a status is to append it in both the
 * Rust contract and here, which is what the bounds check in
 * {@link asDiscriminant} enforces.
 */
const POLICY_STATUSES: readonly PolicyStatus[] = ['Active', 'Settled', 'Expired', 'Cancelled'];
const SETTLEMENT_STATUSES: readonly SettlementStatus[] = ['Paid', 'Expired', 'Pending'];

/** A parametric insurance policy as the registry stores it. */
export interface Policy {
  readonly id: bigint;
  readonly farmer: string;
  /** `sha256` of the plot geometry, hex encoded. */
  readonly plotHash: string;
  readonly cropType: string;
  readonly regionId: string;
  readonly coverageStart: bigint;
  readonly coverageEnd: bigint;
  /** Index value at or below which the policy pays out. */
  readonly triggerThreshold: bigint;
  readonly payoutAmount: bigint;
  readonly premium: bigint;
  readonly status: PolicyStatus;
  readonly createdAt: bigint;
  /** Ledger timestamp of the terminal status; `0n` while the policy is active. */
  readonly settledAt: bigint;
}

/** Result of a settlement attempt. */
export interface SettlementOutcome {
  readonly policyId: bigint;
  readonly status: SettlementStatus;
  readonly indexValue: bigint;
  readonly readingTimestamp: bigint;
  readonly paidAmount: bigint;
}

/** Read-only preview of what settlement would do right now. */
export interface TriggerEvaluation {
  readonly policyId: bigint;
  readonly status: SettlementStatus;
  readonly indexValue: bigint;
  readonly readingTimestamp: bigint;
  readonly payoutAmount: bigint;
}

/** A consistent snapshot of pool health. */
export interface PoolStats {
  readonly reserves: bigint;
  readonly outstandingLiability: bigint;
  readonly minSolvencyRatioBps: bigint;
  /** `i128::MAX` when no liability is recognised, so treat it as unbounded. */
  readonly solvencyRatioBps: bigint;
  readonly totalDeposited: bigint;
  readonly totalReleased: bigint;
  readonly totalWithdrawn: bigint;
}

/** A reading that reached the oracle's signer threshold. */
export interface IndexReading {
  readonly regionId: string;
  readonly indexValue: bigint;
  readonly timestamp: bigint;
  readonly finalizedAt: bigint;
  readonly approvals: number;
}

/** The contracts the engine is wired to on chain. */
export interface EngineContracts {
  readonly policyRegistry: string;
  readonly premiumPool: string;
  readonly oracle: string;
}

/** Thrown when the chain returned something the domain model does not describe. */
export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

function describe(raw: unknown): string {
  if (raw === null) return 'null';
  if (raw === undefined) return 'undefined';
  if (typeof raw === 'bigint') return `bigint ${raw}`;
  if (Array.isArray(raw)) return 'an array';
  return `${typeof raw} ${JSON.stringify(raw, replacer)}`;
}

/** `JSON.stringify` refuses bigints; this one shows them instead of throwing. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function asObject(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DecodeError(`${what}: expected a struct, got ${describe(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function asString(raw: unknown, field: string, what: string): string {
  if (typeof raw !== 'string') {
    throw new DecodeError(`${what}.${field}: expected a string, got ${describe(raw)}`);
  }
  return raw;
}

/**
 * Accepts either a bigint or a number.
 *
 * Both are unambiguous integers, and the contracts use `u64`/`i128` for values
 * that need bigints while using `u32` for counts. Accepting both means a future
 * contract change from `u64` to `u32` narrows the API rather than breaking it.
 */
function asBigInt(raw: unknown, field: string, what: string): bigint {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return BigInt(raw);
  throw new DecodeError(`${what}.${field}: expected an integer, got ${describe(raw)}`);
}

function asNumber(raw: unknown, field: string, what: string): number {
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === 'bigint' && raw >= -9007199254740991n && raw <= 9007199254740991n) {
    return Number(raw);
  }
  throw new DecodeError(`${what}.${field}: expected a small integer, got ${describe(raw)}`);
}

function asBytes(raw: unknown, field: string, what: string): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString('hex');
  throw new DecodeError(`${what}.${field}: expected bytes, got ${describe(raw)}`);
}

function asArray(raw: unknown, what: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new DecodeError(`${what}: expected a list, got ${describe(raw)}`);
  }
  return raw;
}

/**
 * Maps a numeric discriminant onto its name.
 *
 * An out-of-range discriminant means the contract grew a status this build has
 * never heard of, which is precisely the case that must not be guessed at.
 */
function asDiscriminant<T extends string>(
  raw: unknown,
  field: string,
  what: string,
  table: readonly T[],
): T {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    throw new DecodeError(`${what}.${field}: expected a status discriminant, got ${describe(raw)}`);
  }
  const name = table[raw];
  if (name === undefined) {
    throw new DecodeError(
      `${what}.${field}: unknown discriminant ${raw}; this build knows ${table.length} statuses`,
    );
  }
  return name;
}

export function decodeBoolean(raw: unknown, what: string): boolean {
  if (typeof raw !== 'boolean') {
    throw new DecodeError(`${what}: expected a boolean, got ${describe(raw)}`);
  }
  return raw;
}

export function decodePolicy(raw: unknown): Policy {
  const what = 'policy';
  const value = asObject(raw, what);
  return {
    id: asBigInt(value['id'], 'id', what),
    farmer: asString(value['farmer'], 'farmer', what),
    plotHash: asBytes(value['plot_hash'], 'plot_hash', what),
    cropType: asString(value['crop_type'], 'crop_type', what),
    regionId: asString(value['region_id'], 'region_id', what),
    coverageStart: asBigInt(value['coverage_start'], 'coverage_start', what),
    coverageEnd: asBigInt(value['coverage_end'], 'coverage_end', what),
    triggerThreshold: asBigInt(value['trigger_threshold'], 'trigger_threshold', what),
    payoutAmount: asBigInt(value['payout_amount'], 'payout_amount', what),
    premium: asBigInt(value['premium'], 'premium', what),
    status: asDiscriminant(value['status'], 'status', what, POLICY_STATUSES),
    createdAt: asBigInt(value['created_at'], 'created_at', what),
    settledAt: asBigInt(value['settled_at'], 'settled_at', what),
  };
}

export function decodeSettlementOutcome(raw: unknown): SettlementOutcome {
  const what = 'settlement outcome';
  const value = asObject(raw, what);
  return {
    policyId: asBigInt(value['policy_id'], 'policy_id', what),
    status: asDiscriminant(value['status'], 'status', what, SETTLEMENT_STATUSES),
    indexValue: asBigInt(value['index_value'], 'index_value', what),
    readingTimestamp: asBigInt(value['reading_timestamp'], 'reading_timestamp', what),
    paidAmount: asBigInt(value['paid_amount'], 'paid_amount', what),
  };
}

export function decodeTriggerEvaluation(raw: unknown): TriggerEvaluation {
  const what = 'trigger evaluation';
  const value = asObject(raw, what);
  return {
    policyId: asBigInt(value['policy_id'], 'policy_id', what),
    status: asDiscriminant(value['status'], 'status', what, SETTLEMENT_STATUSES),
    indexValue: asBigInt(value['index_value'], 'index_value', what),
    readingTimestamp: asBigInt(value['reading_timestamp'], 'reading_timestamp', what),
    payoutAmount: asBigInt(value['payout_amount'], 'payout_amount', what),
  };
}

export function decodePoolStats(raw: unknown): PoolStats {
  const what = 'pool stats';
  const value = asObject(raw, what);
  return {
    reserves: asBigInt(value['reserves'], 'reserves', what),
    outstandingLiability: asBigInt(
      value['outstanding_liability'],
      'outstanding_liability',
      what,
    ),
    minSolvencyRatioBps: asBigInt(
      value['min_solvency_ratio_bps'],
      'min_solvency_ratio_bps',
      what,
    ),
    solvencyRatioBps: asBigInt(value['solvency_ratio_bps'], 'solvency_ratio_bps', what),
    totalDeposited: asBigInt(value['total_deposited'], 'total_deposited', what),
    totalReleased: asBigInt(value['total_released'], 'total_released', what),
    totalWithdrawn: asBigInt(value['total_withdrawn'], 'total_withdrawn', what),
  };
}

export function decodeEngineContracts(raw: unknown): EngineContracts {
  const what = 'engine contracts';
  const value = asObject(raw, what);
  return {
    policyRegistry: asString(value['policy_registry'], 'policy_registry', what),
    premiumPool: asString(value['premium_pool'], 'premium_pool', what),
    oracle: asString(value['oracle'], 'oracle', what),
  };
}

export function decodeIndexReading(raw: unknown): IndexReading {
  const what = 'index reading';
  const value = asObject(raw, what);
  return {
    regionId: asString(value['region_id'], 'region_id', what),
    indexValue: asBigInt(value['index_value'], 'index_value', what),
    timestamp: asBigInt(value['timestamp'], 'timestamp', what),
    finalizedAt: asBigInt(value['finalized_at'], 'finalized_at', what),
    approvals: asNumber(value['approvals'], 'approvals', what),
  };
}

/** The registry's `Vec<u64>` id indexes. */
export function decodeU64List(raw: unknown, what: string): bigint[] {
  return asArray(raw, what).map((entry) => asBigInt(entry, 'element', what));
}
