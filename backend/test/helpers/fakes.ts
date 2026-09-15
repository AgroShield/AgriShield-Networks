/**
 * Scripted stand-ins for the chain.
 *
 * Everything below the HTTP layer is replaced by something scripted, so tests
 * assert on the backend's own behaviour — the JSON it emits, the decisions the
 * keeper makes — rather than on a network.
 */

import type { ContractCall, InvocationResult, SorobanGateway } from '../../src/contracts/gateway.js';
import { accountAddress } from './env.js';

/**
 * A gateway that answers from a script.
 *
 * Responses are keyed by contract method, which is enough to tell the calls this
 * backend makes apart. A method with no scripted response throws, so a test that
 * forgot to set one fails loudly instead of silently decoding `undefined`.
 */
export class FakeGateway implements SorobanGateway {
  readonly reads: ContractCall[] = [];
  readonly writes: ContractCall[] = [];
  canSubmit = true;
  ledger = 99;

  private readonly readResults = new Map<string, unknown>();
  private readonly readErrors = new Map<string, unknown>();
  private readonly writeResults = new Map<string, InvocationResult>();
  private readonly writeErrors = new Map<string, unknown>();
  private ledgerError: unknown;

  withRead(method: string, value: unknown): this {
    this.readResults.set(method, value);
    return this;
  }

  withReadError(method: string, cause: unknown): this {
    this.readErrors.set(method, cause);
    return this;
  }

  withWrite(method: string, value: InvocationResult): this {
    this.writeResults.set(method, value);
    return this;
  }

  withWriteError(method: string, cause: unknown): this {
    this.writeErrors.set(method, cause);
    return this;
  }

  withLedgerError(cause: unknown): this {
    this.ledgerError = cause;
    return this;
  }

  async read(call: ContractCall): Promise<unknown> {
    this.reads.push(call);
    if (this.readErrors.has(call.method)) throw this.readErrors.get(call.method);
    if (!this.readResults.has(call.method)) {
      throw new Error(`test did not script a response for ${call.method}`);
    }
    return this.readResults.get(call.method);
  }

  async invoke(call: ContractCall): Promise<InvocationResult> {
    this.writes.push(call);
    if (this.writeErrors.has(call.method)) throw this.writeErrors.get(call.method);
    const scripted = this.writeResults.get(call.method);
    if (scripted === undefined) {
      throw new Error(`test did not script a result for ${call.method}`);
    }
    return scripted;
  }

  async latestLedger(): Promise<number> {
    if (this.ledgerError !== undefined) throw this.ledgerError;
    return this.ledger;
  }
}

/** A sample wire-format policy, exactly as `scValToNative` would return it. */
export function wirePolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7n,
    farmer: accountAddress(),
    plot_hash: Buffer.alloc(32, 3),
    crop_type: 'maize',
    region_id: 'ng_kaduna',
    coverage_start: 1_700_000_000n,
    coverage_end: 1_705_000_000n,
    trigger_threshold: 300n,
    payout_amount: 4_000n,
    premium: 1_000n,
    // 0 is the `Active` discriminant.
    status: 0,
    created_at: 1_699_000_000n,
    settled_at: 0n,
    ...overrides,
  };
}
