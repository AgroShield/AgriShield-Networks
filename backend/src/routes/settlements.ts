/**
 * Settlement routes.
 *
 * These are the only endpoints that can move money, so they are also the only
 * ones that need a signing key. Submission is refused outright when none is
 * configured, rather than failing later with an opaque error.
 *
 * The submission is deliberately not a "force settle": it calls the engine's
 * `settle_policy`, which re-derives the decision on chain. An operator cannot
 * use this endpoint to pay a policy the index has not triggered.
 */

import type { FastifyInstance } from 'fastify';

import type { Contracts } from '../contracts/clients.js';
import type { SettlementKeeper } from '../keeper/keeper.js';
import { unavailable } from '../errors.js';
import { serializeOutcome, serializeSweep, type SettlementOutcomeResponse } from '../serializers.js';
import { POLICY_ID_PARAMS, policyIdFrom } from './shared.js';

export interface SettlementRouteDeps {
  readonly contracts: Contracts;
  /** Absent when this deployment runs read-only. */
  readonly keeper: SettlementKeeper | undefined;
  readonly canSubmit: boolean;
}

interface SubmitResponse {
  /** Transaction hash, usable as a handle with any block explorer. */
  transactionHash: string;
  ledger: number;
  outcome: SettlementOutcomeResponse;
}

interface KeeperStatusResponse {
  /** Whether this deployment holds a key and is allowed to settle. */
  enabled: boolean;
  running: boolean;
  /** Next policy id the sweep will start from. */
  cursor: string;
  totals: {
    swept: number;
    settled: number;
    expired: number;
    failed: number;
  };
  lastSweep: ReturnType<typeof serializeSweep> | null;
}

export function registerSettlementRoutes(app: FastifyInstance, deps: SettlementRouteDeps): void {
  const { engine } = deps.contracts;

  app.post<{ Params: { policyId: string } }>(
    '/settlements/:policyId',
    { schema: { params: POLICY_ID_PARAMS } },
    async (request): Promise<SubmitResponse> => {
      if (!deps.canSubmit) {
        throw unavailable(
          'keeper_disabled',
          'this deployment cannot submit settlements because no keeper key is configured',
        );
      }

      const result = await engine.settlePolicy(policyIdFrom(request.params.policyId));
      return {
        transactionHash: result.hash,
        ledger: result.ledger,
        outcome: serializeOutcome(result.outcome),
      };
    },
  );

  app.get('/settlements/keeper', async (): Promise<KeeperStatusResponse> => {
    const keeper = deps.keeper;
    if (keeper === undefined) {
      return {
        enabled: false,
        running: false,
        cursor: '1',
        totals: { swept: 0, settled: 0, expired: 0, failed: 0 },
        lastSweep: null,
      };
    }

    const status = keeper.status();
    return {
      enabled: true,
      running: status.running,
      cursor: status.cursor.toString(),
      totals: status.totals,
      lastSweep: status.lastSweep === undefined ? null : serializeSweep(status.lastSweep),
    };
  });
}
