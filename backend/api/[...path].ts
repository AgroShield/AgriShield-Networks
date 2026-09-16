/**
 * Serverless entrypoint.
 *
 * Serves the same application as `src/index.ts`, for hosts that give a request a
 * function rather than a process. What is missing here is deliberate: **there is
 * no settlement keeper.** A keeper is an interval that submits transactions, and
 * a function has no life between requests to run one in. Omitting
 * `KEEPER_SECRET_KEY` is what disables it, and it is also what keeps a signing
 * key out of the hosting provider's environment entirely — so a serverless
 * deployment can answer every read and cannot move a farmer's money.
 *
 * If a key *is* configured here, the keeper is built but never started. That is
 * a deployment mistake rather than a security hole, so it is logged once instead
 * of failing: the request itself is fine, and a read-only API is not broken by an
 * operator setting a variable they did not need.
 *
 * Reads still need a source account (`SOROBAN_READ_SOURCE`), but simulation
 * ignores the sequence number, so it does not have to exist or be funded.
 *
 * Run the process entrypoint where the keeper is wanted. The two share
 * `buildApp`, so a query answered from a function is answered identically by the
 * process.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { ConfigError, loadConfig } from '../src/config.js';

/**
 * The prefix the host mounts this function under.
 *
 * Fastify's routes do not carry it: in the process deployment they are the whole
 * path. `/api` exists so that the dev proxy and a production reverse proxy have
 * one prefix to match on — in development Vite strips it, and in production the
 * rewrite below does — rather than to be part of the API's own paths.
 */
const MOUNT_PREFIX = '/api';

/** A cold start builds the app once per instance, not once per request. */
let appPromise: Promise<FastifyInstance> | undefined;

function app(): Promise<FastifyInstance> {
  appPromise ??= (async () => {
    const { app: instance, keeper } = buildApp(loadConfig());
    if (keeper !== undefined) {
      instance.log.warn(
        'KEEPER_SECRET_KEY is set but a serverless deployment cannot run the keeper; ' +
          'no sweep will happen. Unset it here, or run the process entrypoint.',
      );
    }
    await instance.ready();
    return instance;
  })();
  return appPromise;
}

export default async function handler(
  request: IncomingMessage,
  reply: ServerResponse,
): Promise<void> {
  let instance: FastifyInstance;
  try {
    instance = await app();
  } catch (cause) {
    // A misconfigured deployment answers with the reason. The message is safe to
    // return: `loadConfig` names the variable at fault and never echoes a value,
    // and `KEEPER_SECRET_KEY` is only ever reported as unparseable.
    appPromise = undefined;
    const isConfig = cause instanceof ConfigError;
    const message = isConfig
      ? (cause as Error).message
      : 'the server could not be started';
    if (!isConfig) {
      process.stderr.write(`startup failed: ${String(cause)}\n`);
    }
    reply.statusCode = 500;
    reply.setHeader('content-type', 'application/json');
    reply.end(
      JSON.stringify({
        error: { code: isConfig ? 'configuration_error' : 'startup_failed', message },
      }),
    );
    return;
  }

  // Strip the mount prefix so the same routes match here as in the process.
  const url = request.url ?? '/';
  if (url === MOUNT_PREFIX) {
    request.url = '/';
  } else if (url.startsWith(`${MOUNT_PREFIX}/`)) {
    request.url = url.slice(MOUNT_PREFIX.length);
  }

  // Handing the request to the underlying listener is the supported way to run
  // Fastify on a host that owns the socket. `ready()` has already resolved, so
  // no route can be missing when this runs.
  instance.server.emit('request', request, reply);
}
