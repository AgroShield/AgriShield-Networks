/**
 * Process entrypoint.
 *
 * Wiring order matters: configuration is validated before anything is built, the
 * app is created before the keeper because the keeper logs through it, and the
 * keeper is started before the server accepts traffic so a deployment is either
 * fully up or not up at all. That order lives in `buildApp`; what is left here is
 * everything that only makes sense for a long-lived process: starting the keeper
 * and handling the signals that stop it.
 *
 * A serverless deployment does not run this file. See `api/[...path].ts`.
 */

import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { buildApp } from './app.js';

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

  const { app, keeper } = buildApp(config);

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

await main();
