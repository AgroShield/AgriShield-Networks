/**
 * A scripted API client for the component tests.
 *
 * The console takes its client as a prop, so rendering it against this is a test
 * of the console rather than of the client — the client's own suite covers the
 * wire format against a scripted `fetch`. Each method records that it was called
 * and answers with whatever the test put in the matching field, so "the button
 * submitted a settlement" and "the panel did not ask twice" are both assertions
 * about an array.
 */

import type { ApiClient, PolicyQuery } from '../../src/api/client';
import type {
  Evaluation,
  Health,
  KeeperStatus,
  Policy,
  PolicyList,
  SubmittedSettlement,
} from '../../src/api/types';

/** A policy with plausible values; every field is overridable. */
export function samplePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: '7',
    farmer: 'GBZXQ4K7YQ2F6W5T3RZP4N6H2J5L8M3C9V1B7D4S6A8E2U5I0O3K',
    plotHash: 'ab'.repeat(32),
    cropType: 'maize',
    regionId: 'ng_kaduna',
    coverageStart: '1700000000',
    coverageEnd: '1705000000',
    triggerThreshold: '300',
    payoutAmount: '4000',
    premium: '1000',
    status: 'Active',
    createdAt: '1699000000',
    settledAt: '0',
    ...overrides,
  };
}

export function sampleList(policies: Policy[], total = policies.length): PolicyList {
  return { policyIds: policies.map((policy) => policy.id), total, policies };
}

export function samplePreview(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    policyId: '7',
    status: 'Pending',
    indexValue: '0',
    readingTimestamp: '0',
    payoutAmount: '0',
    ...overrides,
  };
}

export function sampleSettlement(
  overrides: Partial<SubmittedSettlement> = {},
): SubmittedSettlement {
  return {
    transactionHash: 'hash-7',
    ledger: 51,
    outcome: {
      policyId: '7',
      status: 'Paid',
      indexValue: '120',
      readingTimestamp: '1700000000',
      paidAmount: '4000',
    },
    ...overrides,
  };
}

export function sampleHealth(overrides: Partial<Health> = {}): Health {
  return {
    status: 'ok',
    network: 'testnet',
    ledger: 42,
    contracts: { registry: 'C1', engine: 'C2', pool: 'C3', oracle: 'C4' },
    onChain: { policyRegistry: 'C1', premiumPool: 'C3', oracle: 'C4' },
    keeper: { enabled: true },
    reason: null,
    ...overrides,
  };
}

export function sampleKeeper(overrides: Partial<KeeperStatus> = {}): KeeperStatus {
  return {
    enabled: true,
    running: true,
    cursor: '4',
    totals: { swept: 5, settled: 1, expired: 2, failed: 0 },
    lastSweep: {
      startedAt: 1700000000000,
      finishedAt: 1700000000500,
      considered: 3,
      settled: 1,
      expired: 1,
      failed: 0,
      entries: [],
    },
    ...overrides,
  };
}

/** The calls the console made, by method name. */
export type CallName =
  | 'health'
  | 'listPolicies'
  | 'getPolicy'
  | 'settlementPreview'
  | 'settle'
  | 'keeperStatus';

export class ScriptedClient implements ApiClient {
  readonly baseUrl = '/api';
  readonly calls: CallName[] = [];
  /** The query each list call was made with. */
  readonly queries: PolicyQuery[] = [];

  /** Ids the detail and preview calls were made for, in order. */
  readonly policyIds: string[] = [];
  /** Ids a submission was made for, in order. */
  readonly settledIds: string[] = [];
  /** Per-policy detail, so two policies can be told apart; falls back to `policyResult`. */
  readonly policiesById = new Map<string, Policy | Error>();

  healthResult: Health | Error = sampleHealth();
  listResult: PolicyList | Error = sampleList([samplePolicy()]);
  policyResult: Policy | Error = samplePolicy();
  previewResult: Evaluation | Error = samplePreview();
  settleResult: SubmittedSettlement | Error = sampleSettlement();
  keeperResult: KeeperStatus | Error = sampleKeeper();
  /**
   * What `keeperStatus` answers, call by call, before falling back to
   * `keeperResult`.
   *
   * The panel is supposed to re-read after a settlement, and a fixed answer
   * cannot show that it did — the test would pass whether the re-read happened
   * or not. The first entry is the mount's answer, the second the one after.
   */
  readonly keeperResults: KeeperStatus[] = [];
  /** How many times `keeperStatus` has been asked, indexing `keeperResults`. */
  keeperCalls = 0;

  async health(): Promise<Health> {
    this.calls.push('health');
    return answer(this.healthResult);
  }

  async listPolicies(query: PolicyQuery): Promise<PolicyList> {
    this.calls.push('listPolicies');
    this.queries.push(query);
    return answer(this.listResult);
  }

  async getPolicy(policyId: string): Promise<Policy> {
    this.calls.push('getPolicy');
    this.policyIds.push(policyId);
    return answer(this.policiesById.get(policyId) ?? this.policyResult);
  }

  async settlementPreview(policyId: string): Promise<Evaluation> {
    this.calls.push('settlementPreview');
    this.policyIds.push(policyId);
    return answer(this.previewResult);
  }

  async settle(policyId: string): Promise<SubmittedSettlement> {
    this.calls.push('settle');
    this.settledIds.push(policyId);
    return answer(this.settleResult);
  }

  async keeperStatus(): Promise<KeeperStatus> {
    this.calls.push('keeperStatus');
    const queued = this.keeperResults[this.keeperCalls];
    this.keeperCalls += 1;
    return answer(queued ?? this.keeperResult);
  }
}

/** How many times one method was called. */
export function callsTo(client: ScriptedClient, name: CallName): number {
  return client.calls.filter((call) => call === name).length;
}

function answer<T>(result: T | Error): T {
  if (result instanceof Error) throw result;
  return result;
}
