/**
 * Policy routes.
 *
 * Read-only by construction: every handler here is a simulation, so the API can
 * serve policy data without holding a key at all. The one thing the registry
 * cannot answer directly — whether a policy would pay out right now — is
 * answered by the engine's preview, which is the same decision procedure that
 * on-chain settlement uses.
 */

import type { FastifyInstance } from 'fastify';

import type { Contracts, PolicyRecord } from '../contracts/clients.js';
import { badRequest } from '../errors.js';
import {
  serializeEvaluation,
  serializePolicy,
  type EvaluationResponse,
  type PolicyResponse,
} from '../serializers.js';
import {
  DEFAULT_LIST_LIMIT,
  POLICY_ID_PARAMS,
  POLICY_LIST_QUERY,
  farmerAddress,
  policyIdFrom,
} from './shared.js';

/**
 * LRU cache with TTL for policy records to eliminate N+1 RPC queries.
 */
export class PolicyCache {
  private readonly cache = new Map<string, { policy: PolicyRecord; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 1000, ttlMs = 15_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(id: bigint | string): PolicyRecord | undefined {
    const key = id.toString();
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.policy;
  }

  set(id: bigint | string, policy: PolicyRecord): void {
    const key = id.toString();
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { policy, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export interface PolicyRouteDeps {
  readonly contracts: Contracts;
  readonly cache?: PolicyCache;
}

interface ListQuery {
  farmer?: string;
  region?: string;
  limit?: number;
}

interface ListResponse {
  /** Every id the registry knows for the filter, oldest first. */
  policyIds: string[];
  /** Total ids matched, which may exceed the number of hydrated policies. */
  total: number;
  /** The newest `limit` of them, fully hydrated. */
  policies: PolicyResponse[];
}

export function registerPolicyRoutes(app: FastifyInstance, deps: PolicyRouteDeps): void {
  const { registry, engine } = deps.contracts;
  const cache = deps.cache ?? new PolicyCache();

  async function resolvePolicy(id: bigint): Promise<PolicyRecord> {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const policy = await registry.getPolicy(id);
    cache.set(id, policy);
    return policy;
  }

  app.get<{ Querystring: ListQuery }>(
    '/policies',
    { schema: { querystring: POLICY_LIST_QUERY } },
    async (request): Promise<ListResponse> => {
      const { farmer, region } = request.query;
      const limit = request.query.limit ?? DEFAULT_LIST_LIMIT;

      // Exactly one filter: both together would be ambiguous, neither would scan
      // the whole book.
      if ((farmer === undefined) === (region === undefined)) {
        throw badRequest(
          'invalid_query',
          'exactly one of `farmer` or `region` must be provided',
        );
      }

      const ids =
        farmer !== undefined
          ? await registry.farmerPolicies(farmerAddress(farmer))
          : await registry.regionPolicies(region as string);

      // The registry returns ids oldest first, so the newest end is the more
      // useful slice to hydrate.
      const newestFirst = [...ids].reverse().slice(0, limit);
      const policies = await Promise.all(newestFirst.map((id) => resolvePolicy(id)));

      return {
        policyIds: ids.map((id) => id.toString()),
        total: ids.length,
        policies: policies.map(serializePolicy),
      };
    },
  );

  app.get<{ Params: { policyId: string } }>(
    '/policies/:policyId',
    { schema: { params: POLICY_ID_PARAMS } },
    async (request): Promise<PolicyResponse> => {
      const policy = await resolvePolicy(policyIdFrom(request.params.policyId));
      return serializePolicy(policy);
    },
  );

  app.get<{ Params: { policyId: string } }>(
    '/policies/:policyId/settlement',
    { schema: { params: POLICY_ID_PARAMS } },
    async (request): Promise<EvaluationResponse> => {
      const evaluation = await engine.evaluate(policyIdFrom(request.params.policyId));
      return serializeEvaluation(evaluation);
    },
  );
}
