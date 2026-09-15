/**
 * Process entrypoint.
 *
 * Wiring order matters: configuration is validated before anything is built, the
 * app is created before the keeper because the keeper logs through it, and the
 * keeper is started before the server accepts traffic so a deployment is either
 * fully up or not up at all.
 */

import { Keypair } from '@stellar/stellar-sdk';

import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { createContracts } from './contracts/clients.js';
import { RpcSorobanGateway } from './contracts/gateway.js';
import { SettlementKeeper } from './keeper/keeper.js';
import { createApp, registerRoutes } from './server.js';

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (cause) {
    if (cause instanceof ConfigError) {
      // Boot-time configuration problems are the operator's to fix, so state the
      // problem plainly on stderr and exit non-zero.
      process.stderr.write(`configuration error: ${cause.message}\n`);
      process.exitCode = 78; // EX_CONFIG
      return;
    }
    throw cause;
  }

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
    network: networkName(config),
    keeper,
  });

  keeper?.start();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    // Stop sweeping first and wait for the sweep in flight, so a transaction is
    // never cut off between signing and inclusion.
    await keeper?.stop();
    await app.close();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(
        () => process.exit(0),
        (cause: unknown) => {
          app.log.error({ err: cause }, 'shutdown failed');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ host: config.server.host, port: config.server.port });
}

/** The configured network's friendly name, for logs and the health endpoint. */
function networkName(config: AppConfig): string {
  return config.soroban.networkPassphrase;
}

await main();
