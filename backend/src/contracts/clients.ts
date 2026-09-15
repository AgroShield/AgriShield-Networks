/**
 * Typed wrappers around the four contracts.
 *
 * Each wrapper owns the argument types for the functions it calls, so no route
 * ever hand-builds a `nativeToScVal` argument and getting a Soroban type wrong
 * is a mistake the compiler catches rather than a rejected transaction in
 * production.
 *
 * The wrappers also translate the contracts' own error codes into HTTP-shaped
 * errors where the code carries a meaning the API should expose: an unknown
 * policy id becomes a 404, a policy that has already left the book becomes a
 * 409. Codes with no agreed meaning stay a 502 that names the contract and the
 * reason, so an unmapped failure is still diagnosable.
 */

import { AppError, badGateway, unavailable, type ErrorStatus } from '../errors.js';
import type { ContractAddresses } from './addresses.js';

export type { ContractAddresses };
import {
  ContractCallError,
  type InvocationResult,
  type SorobanArg,
  type SorobanGateway,
} from './gateway.js';
import {
  DecodeError,
  decodeBoolean,
  decodeEngineContracts,
  decodeIndexReading,
  decodePoolStats,
  decodePolicy,
  decodeSettlementOutcome,
  decodeTriggerEvaluation,
  decodeU64List,
  type EngineContracts,
  type IndexReading,
  type Policy,
  type PoolStats,
  type SettlementOutcome,
  type TriggerEvaluation,
} from './types.js';

// ---------------------------------------------------------------------------
// Argument builders
// ---------------------------------------------------------------------------

const u64 = (value: bigint): SorobanArg => ({ type: 'u64', value });
const address = (value: string): SorobanArg => ({ type: 'address', value });
const symbol = (value: string): SorobanArg => ({ type: 'symbol', value });

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

interface ErrorMapping {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly message: string;
}

/** `policy-registry` codes this API gives a meaning to. */
const REGISTRY_ERRORS: Readonly<Record<number, ErrorMapping>> = {
  12: { code: 'policy_not_found', status: 404, message: 'no policy exists under that id' },
  13: { code: 'policy_not_active', status: 409, message: 'the policy has already left the book' },
};

/** `payout-engine` codes this API gives a meaning to. */
const ENGINE_ERRORS: Readonly<Record<number, ErrorMapping>> = {
  6: { code: 'policy_not_found', status: 404, message: 'no policy exists under that id' },
  7: { code: 'policy_not_active', status: 409, message: 'the policy has already left the book' },
  11: {
    code: 'engine_not_registered',
    status: 502,
    message: 'this engine is not the registered payout engine',
  },
  12: {
    code: 'liability_already_registered',
    status: 409,
    message: 'cover liability is already recognised for that policy',
  },
  13: {
    code: 'coverage_still_open',
    status: 409,
    message: 'the coverage window has not closed yet',
  },
  14: {
    code: 'policy_still_active',
    status: 409,
    message: 'the policy is still live, so its cover cannot be released',
  },
};

/**
 * Converts whatever the gateway threw into an error the API can answer with.
 *
 * The three cases are kept apart on purpose: a contract that rejected the call
 * is the caller's business (404/409/502), a value this build cannot decode means
 * the ABI moved (502), and anything else is the network being unreachable (503).
 */
function toAppError(
  cause: unknown,
  mappings: Readonly<Record<number, ErrorMapping>>,
  context: string,
): AppError {
  if (cause instanceof ContractCallError) {
    const contractCode = cause.contractCode;
    const mapping = contractCode === undefined ? undefined : mappings[contractCode];
    if (mapping !== undefined) {
      return new AppError(mapping.status, mapping.code, mapping.message, {
        context,
        contractCode,
      });
    }
    return badGateway('contract_call_failed', `${context} was rejected by the contract`, {
      contractId: cause.contractId,
      method: cause.method,
      contractCode: contractCode ?? null,
      reason: cause.message,
    });
  }

  if (cause instanceof DecodeError) {
    return badGateway(
      'contract_shape_changed',
      `${context} returned a value this build does not understand`,
      { reason: cause.message },
    );
  }

  return unavailable('rpc_unavailable', `${context} could not reach the network`, {
    reason: cause instanceof Error ? cause.message : String(cause),
  });
}

function integer(raw: unknown, what: string): bigint {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return BigInt(raw);
  throw new DecodeError(`${what}: expected an integer, got ${typeof raw}`);
}

// ---------------------------------------------------------------------------
// policy-registry
// ---------------------------------------------------------------------------

export class PolicyRegistry {
  constructor(
    private readonly gateway: SorobanGateway,
    readonly contractId: string,
  ) {}

  async getPolicy(policyId: bigint): Promise<Policy> {
    return this.read('get_policy', [u64(policyId)], decodePolicy);
  }

  async isActive(policyId: bigint): Promise<boolean> {
    return this.read('is_active', [u64(policyId)], (raw) => decodeBoolean(raw, 'is_active'));
  }

  async policyCount(): Promise<bigint> {
    return this.read('get_policy_count', [], (raw) => integer(raw, 'get_policy_count'));
  }

  async farmerPolicies(farmer: string): Promise<bigint[]> {
    return this.read('get_farmer_policies', [address(farmer)], (raw) =>
      decodeU64List(raw, 'get_farmer_policies'),
    );
  }

  async regionPolicies(regionId: string): Promise<bigint[]> {
    return this.read('get_region_policies', [symbol(regionId)], (raw) =>
      decodeU64List(raw, 'get_region_policies'),
    );
  }

  async escrowBalance(): Promise<bigint> {
    return this.read('escrow_balance', [], (raw) => integer(raw, 'escrow_balance'));
  }

  private async read<T>(method: string, args: SorobanArg[], decode: (raw: unknown) => T): Promise<T> {
    try {
      return decode(await this.gateway.read({ contractId: this.contractId, method, args }));
    } catch (cause) {
      throw toAppError(cause, REGISTRY_ERRORS, `policy-registry.${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// payout-engine
// ---------------------------------------------------------------------------

/** A transaction the network included. */
export interface Submitted {
  readonly hash: string;
  readonly ledger: number;
}

export interface SettleResult extends Submitted {
  readonly outcome: SettlementOutcome;
}

export class PayoutEngine {
  constructor(
    private readonly gateway: SorobanGateway,
    readonly contractId: string,
  ) {}

  /** Read-only preview; safe to call for every live policy on every sweep. */
  async evaluate(policyId: bigint): Promise<TriggerEvaluation> {
    return this.read('evaluate', [u64(policyId)], decodeTriggerEvaluation);
  }

  /** Settles a policy: pays a triggered claim, expires a closed window, or no-ops. */
  async settlePolicy(policyId: bigint): Promise<SettleResult> {
    const result = await this.submit('settle_policy', [u64(policyId)]);
    return {
      hash: result.hash,
      ledger: result.ledger,
      outcome: decodeSettlementOutcome(result.returnValue),
    };
  }

  /** Marks a closed-window policy expired without waiting on oracle history. */
  async expirePolicy(policyId: bigint): Promise<Submitted> {
    const { hash, ledger } = await this.submit('expire_policy', [u64(policyId)]);
    return { hash, ledger };
  }

  async registerLiability(policyId: bigint): Promise<Submitted> {
    const { hash, ledger } = await this.submit('register_liability', [u64(policyId)]);
    return { hash, ledger };
  }

  async releaseLiability(policyId: bigint): Promise<Submitted> {
    const { hash, ledger } = await this.submit('release_liability', [u64(policyId)]);
    return { hash, ledger };
  }

  /** The contracts this engine is wired to on chain. */
  async contracts(): Promise<EngineContracts> {
    return this.read('contracts', [], decodeEngineContracts);
  }

  async liabilityRegistered(policyId: bigint): Promise<boolean> {
    return this.read('liability_registered', [u64(policyId)], (raw) =>
      decodeBoolean(raw, 'liability_registered'),
    );
  }

  private async read<T>(method: string, args: SorobanArg[], decode: (raw: unknown) => T): Promise<T> {
    try {
      return decode(await this.gateway.read({ contractId: this.contractId, method, args }));
    } catch (cause) {
      throw toAppError(cause, ENGINE_ERRORS, `payout-engine.${method}`);
    }
  }

  private async submit(method: string, args: SorobanArg[]): Promise<InvocationResult> {
    try {
      return await this.gateway.invoke({ contractId: this.contractId, method, args });
    } catch (cause) {
      throw toAppError(cause, ENGINE_ERRORS, `payout-engine.${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// premium-pool
// ---------------------------------------------------------------------------

export class PremiumPool {
  constructor(
    private readonly gateway: SorobanGateway,
    readonly contractId: string,
  ) {}

  async stats(): Promise<PoolStats> {
    return this.read('stats', [], decodePoolStats);
  }

  async outstandingLiability(): Promise<bigint> {
    return this.read('outstanding_liability', [], (raw) =>
      integer(raw, 'outstanding_liability'),
    );
  }

  async reserves(): Promise<bigint> {
    return this.read('reserves', [], (raw) => integer(raw, 'reserves'));
  }

  async isSolvent(): Promise<boolean> {
    return this.read('is_solvent', [], (raw) => decodeBoolean(raw, 'is_solvent'));
  }

  private async read<T>(method: string, args: SorobanArg[], decode: (raw: unknown) => T): Promise<T> {
    try {
      return decode(await this.gateway.read({ contractId: this.contractId, method, args }));
    } catch (cause) {
      throw toAppError(cause, {}, `premium-pool.${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// oracle-adapter
// ---------------------------------------------------------------------------

export class OracleAdapter {
  constructor(
    private readonly gateway: SorobanGateway,
    readonly contractId: string,
  ) {}

  async hasReading(regionId: string): Promise<boolean> {
    return this.read('has_reading', [symbol(regionId)], (raw) =>
      decodeBoolean(raw, 'has_reading'),
    );
  }

  async latestIndex(regionId: string): Promise<IndexReading> {
    return this.read('get_latest_index', [symbol(regionId)], decodeIndexReading);
  }

  async indexHistory(regionId: string): Promise<IndexReading[]> {
    return this.read('get_index_history', [symbol(regionId)], (raw) => {
      if (!Array.isArray(raw)) throw new DecodeError('get_index_history: expected a list');
      return raw.map((entry) => decodeIndexReading(entry));
    });
  }

  async threshold(): Promise<number> {
    return this.read('get_threshold', [], (raw) => {
      if (typeof raw !== 'number') {
        throw new DecodeError(`get_threshold: expected a number, got ${typeof raw}`);
      }
      return raw;
    });
  }

  private async read<T>(method: string, args: SorobanArg[], decode: (raw: unknown) => T): Promise<T> {
    try {
      return decode(await this.gateway.read({ contractId: this.contractId, method, args }));
    } catch (cause) {
      throw toAppError(cause, {}, `oracle-adapter.${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/** The four contracts, wired to one gateway. */
export interface Contracts {
  readonly registry: PolicyRegistry;
  readonly engine: PayoutEngine;
  readonly pool: PremiumPool;
  readonly oracle: OracleAdapter;
}

export function createContracts(gateway: SorobanGateway, addresses: ContractAddresses): Contracts {
  return {
    registry: new PolicyRegistry(gateway, addresses.registry),
    engine: new PayoutEngine(gateway, addresses.engine),
    pool: new PremiumPool(gateway, addresses.pool),
    oracle: new OracleAdapter(gateway, addresses.oracle),
  };
}
