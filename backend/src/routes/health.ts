/**
 * Health and wiring checks.
 *
 * A backend that can reach the network but is pointed at different contracts
 * than the engine settles against is the most dangerous misconfiguration this
 * service can have: every answer it gives would be confidently wrong. The health
 * check therefore reads the engine's on-chain wiring back and compares it with
 * the configured addresses, instead of reporting "OK" merely because the RPC
 * node answered.
 *
 * The status is deliberately 503 for both the unreachable case and the mismatch
 * case, so an orchestrator takes the instance out of service either way; `status`
 * and `reason` distinguish them for a human.
 */

import type { FastifyInstance } from 'fastify';

import type { ContractAddresses, Contracts } from '../contracts/clients.js';
import type { SorobanGateway } from '../contracts/gateway.js';
import type { EngineContracts } from '../contracts/types.js';
import { describeError } from '../errors.js';

export interface HealthRouteDeps {
  readonly gateway: SorobanGateway;
  readonly contracts: Contracts;
  readonly addresses: ContractAddresses;
  readonly network: string;
  readonly keeperEnabled: boolean;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  network: string;
  /** Latest ledger the node reported, or null when it could not be reached. */
  ledger: number | null;
  /** Addresses this process was told to use. */
  contracts: ContractAddresses;
  /** Wiring read back from the engine, when it could be read. */
  onChain: EngineContracts | null;
  keeper: { enabled: boolean };
  reason: string | null;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get('/health', async (request, reply) => {
    const base = {
      network: deps.network,
      contracts: deps.addresses,
      keeper: { enabled: deps.keeperEnabled },
    };

    let ledger: number;
    try {
      ledger = await deps.gateway.latestLedger();
    } catch (cause) {
      request.log.error({ err: describeError(cause) }, 'health check could not reach the node');
      const body: HealthResponse = {
        ...base,
        status: 'down',
        ledger: null,
        onChain: null,
        reason: describeError(cause),
      };
      return reply.code(503).send(body);
    }

    let onChain: EngineContracts;
    try {
      onChain = await deps.contracts.engine.contracts();
    } catch (cause) {
      request.log.error({ err: describeError(cause) }, 'health check could not read engine wiring');
      const body: HealthResponse = {
        ...base,
        status: 'degraded',
        ledger,
        onChain: null,
        reason: describeError(cause),
      };
      return reply.code(503).send(body);
    }

    if (!wiringMatches(deps.addresses, onChain)) {
      const body: HealthResponse = {
        ...base,
        status: 'degraded',
        ledger,
        onChain,
        reason:
          'the engine on chain is wired to different contracts than this API is configured with',
      };
      return reply.code(503).send(body);
    }

    const body: HealthResponse = { ...base, status: 'ok', ledger, onChain, reason: null };
    return reply.code(200).send(body);
  });
}

function wiringMatches(configured: ContractAddresses, onChain: EngineContracts): boolean {
  return (
    configured.registry === onChain.policyRegistry &&
    configured.pool === onChain.premiumPool &&
    configured.oracle === onChain.oracle
  );
}
