/**
 * Builds the application: configuration in, a wired Fastify instance out.
 *
 * This exists because there are two ways to run this backend and they must not
 * drift apart. `index.ts` runs it as a long-lived process, which is the only way
 * to run the settlement keeper. `api/[...path].ts` runs it as a serverless
 * function, where a request has no process to belong to and so the keeper cannot
 * exist at all.
 *
 * Sharing this function is what keeps a read served from a function identical to
 * the same read served from the process: one gateway, one set of contract
 * wrappers, one error handler. Duplicating the wiring would let the two diverge
 * quietly, and the difference would show up as a different answer for the same
 * query depending on where it happened to run.
 */

import { Keypair } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import { createContracts } from './contracts/clients.js';
import { RpcSorobanGateway } from './contracts/gateway.js';
import { SettlementKeeper } from './keeper/keeper.js';
import { createApp, registerRoutes } from './server.js';

export interface BuiltApp {
  readonly app: FastifyInstance;
  /** Present only when a signing key is configured; absent means read-only. */
  readonly keeper: SettlementKeeper | undefined;
}

/** The gateway, contracts, app, keeper and routes, wired in dependency order. */
export function buildApp(config: AppConfig): BuiltApp {
  const keeperKey =
    config.soroban.keeperSecret === undefined
      ? undefined
      : Keypair.fromSecret(config.soroban.keeperSecret);

  const gateway = new RpcSorobanGateway({
    rpcUrl: config.soroban.rpcUrl,
    networkPassphrase: config.soroban.networkPassphrase,
    readSource: config.soroban.readSource,
    keeper: keeperKey,
  });
  const contracts = createContracts(gateway, config.soroban.addresses);

  const app = createApp(config);

  const keeper = config.keeper.enabled
    ? new SettlementKeeper({
        registry: contracts.registry,
        engine: contracts.engine,
        intervalMs: config.keeper.intervalMs,
        batchSize: config.keeper.batchSize,
        logger: app.log,
      })
    : undefined;

  registerRoutes(app, {
    gateway,
    contracts,
    addresses: config.soroban.addresses,
    network: config.soroban.network,
    keeper,
  });

  return { app, keeper };
}
