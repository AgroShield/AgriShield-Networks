/**
 * The HTTP surface.
 *
 * Building the app and registering routes are separate steps on purpose: the
 * keeper needs a logger, and the logger belongs to the app. Creating the app
 * first, then the keeper, then the routes keeps that dependency pointing one way
 * instead of being broken by a circular argument.
 */

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import type { ContractAddresses, Contracts } from './contracts/clients.js';
import { ContractCallError, type SorobanGateway } from './contracts/gateway.js';
import { AppError, describeError } from './errors.js';
import type { SettlementKeeper } from './keeper/keeper.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPolicyRoutes } from './routes/policies.js';
import { registerSettlementRoutes } from './routes/settlements.js';
import { registerDocsRoutes } from './routes/docs.js';

/** Every error response has this shape, so clients need one parser. */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface RouteDeps {
  readonly gateway: SorobanGateway;
  readonly contracts: Contracts;
  readonly addresses: ContractAddresses;
  readonly network: string;
  readonly keeper: SettlementKeeper | undefined;
  readonly apiKey?: string | undefined;
}

/** Creates the Fastify instance, its logger and its error handling. */
export function createApp(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: { level: config.server.logLevel } });

  // CORS support
  const allowedOrigin = config.server.corsOrigin ?? '*';
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', allowedOrigin);
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  // Security headers
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Content-Security-Policy', "default-src 'self'");
    return payload;
  });

  // Sliding window rate limiter
  const rateLimitMax = config.server.rateLimitMax ?? 100;
  const rateLimitWindowMs = config.server.rateLimitWindowMs ?? 60_000;
  const requestLogs = new Map<string, number[]>();

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/health') || request.url === '/live' || request.url === '/ready') {
      return;
    }

    const ip = request.ip || '127.0.0.1';
    const now = Date.now();
    const timestamps = (requestLogs.get(ip) ?? []).filter((ts) => now - ts < rateLimitWindowMs);

    if (timestamps.length >= rateLimitMax) {
      reply.header('x-ratelimit-limit', rateLimitMax);
      reply.header('x-ratelimit-remaining', 0);
      reply.header('x-ratelimit-reset', Math.ceil((now + rateLimitWindowMs) / 1000));
      return reply.code(429).send(
        errorBody('rate_limit_exceeded', 'too many requests, please slow down', {
          retryAfterMs: rateLimitWindowMs - (now - (timestamps[0] ?? now)),
        }),
      );
    }

    timestamps.push(now);
    requestLogs.set(ip, timestamps);

    const remaining = Math.max(0, rateLimitMax - timestamps.length);
    const reset = Math.ceil((now + rateLimitWindowMs) / 1000);

    reply.header('x-ratelimit-limit', rateLimitMax);
    reply.header('x-ratelimit-remaining', remaining);
    reply.header('x-ratelimit-reset', reset);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      // Expected failures are the caller's business, so log them quietly.
      request.log.warn({ code: error.code }, error.message);
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }

    if (error instanceof ContractCallError) {
      // The client wrappers translate what they can; anything reaching here is a
      // code this build has no meaning for, so surface the context operators
      // need rather than a bare 500.
      request.log.error(
        { contractId: error.contractId, method: error.method, contractCode: error.contractCode },
        error.message,
      );
      return reply.code(502).send(
        errorBody('contract_call_failed', 'the contract rejected the call', {
          contractId: error.contractId,
          method: error.method,
          contractCode: error.contractCode ?? null,
          reason: error.message,
        }),
      );
    }

    if (error.validation !== undefined) {
      return reply
        .code(400)
        .send(errorBody('invalid_request', error.message, { validation: error.validation }));
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      // Fastify's own 4xx errors: malformed JSON, unknown content type, and so on.
      return reply.code(statusCode).send(errorBody('invalid_request', error.message));
    }

    // A bug. The reason goes to the log, never to the client.
    request.log.error({ err: describeError(error), stack: error.stack }, 'unhandled error');
    return reply
      .code(500)
      .send(errorBody('internal_error', 'the request could not be completed'));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .code(404)
      .send(errorBody('not_found', `no route matches ${request.method} ${request.url}`));
  });

  return app;
}

/** Registers every route group. Call after the keeper exists. */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerHealthRoutes(app, {
    gateway: deps.gateway,
    contracts: deps.contracts,
    addresses: deps.addresses,
    network: deps.network,
    keeperEnabled: deps.keeper !== undefined,
  });

  registerPolicyRoutes(app, { contracts: deps.contracts });

  registerSettlementRoutes(app, {
    contracts: deps.contracts,
    keeper: deps.keeper,
    canSubmit: deps.gateway.canSubmit,
    apiKey: deps.apiKey,
  });

  registerDocsRoutes(app);
}

function errorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
