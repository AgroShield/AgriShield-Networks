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

import type { Contracts } from '../contracts/clients.js';
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

export interface PolicyRouteDeps {
  readonly contracts: Contracts;
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
      const policies = await Promise.all(newestFirst.map((id) => registry.getPolicy(id)));

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
      const policy = await registry.getPolicy(policyIdFrom(request.params.policyId));
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
