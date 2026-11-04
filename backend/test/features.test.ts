import { describe, expect, it } from 'vitest';

import { createContracts } from '../src/contracts/clients.js';
import { AsyncMutex } from '../src/contracts/gateway.js';
import { MemoryCursorStore, SettlementKeeper } from '../src/keeper/keeper.js';
import { PolicyCache } from '../src/routes/policies.js';
import { createApp, registerRoutes } from '../src/server.js';
import { testConfig } from './helpers/env.js';
import { FakeGateway } from './helpers/fakes.js';

describe('AsyncMutex', () => {
  it('serializes concurrent tasks and preserves order', async () => {
    const mutex = new AsyncMutex();
    const log: number[] = [];

    const p1 = mutex.runExclusive(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push(1);
    });

    const p2 = mutex.runExclusive(async () => {
      log.push(2);
    });

    await Promise.all([p1, p2]);
    expect(log).toEqual([1, 2]);
  });

  it('does not deadlock if a task throws an error', async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    let succeeded = false;
    await mutex.runExclusive(async () => {
      succeeded = true;
    });
    expect(succeeded).toBe(true);
  });
});

describe('PolicyCache', () => {
  it('stores and retrieves cached policies', () => {
    const cache = new PolicyCache(10, 1000);
    const mockPolicy = { id: 1n, farmer: 'G...', cropType: 'Wheat' } as any;

    cache.set(1n, mockPolicy);
    expect(cache.get(1n)).toEqual(mockPolicy);
    expect(cache.get(2n)).toBeUndefined();
  });

  it('evicts oldest entries when capacity limit is reached', () => {
    const cache = new PolicyCache(2, 1000);
    cache.set(1n, { id: 1n } as any);
    cache.set(2n, { id: 2n } as any);
    cache.set(3n, { id: 3n } as any);

    expect(cache.get(1n)).toBeUndefined();
    expect(cache.get(2n)).toBeDefined();
    expect(cache.get(3n)).toBeDefined();
  });

  it('expires entries after TTL', async () => {
    const cache = new PolicyCache(10, 10); // 10ms TTL
    cache.set(1n, { id: 1n } as any);
    expect(cache.get(1n)).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cache.get(1n)).toBeUndefined();
  });
});

describe('Security headers and rate limiting', () => {
  function testApp(rateLimitMax = 2) {
    const app = createApp({
      soroban: {
        network: 'testnet',
        rpcUrl: 'http://localhost:8000',
        networkPassphrase: 'Test SDF Network ; September 2015',
        addresses: {
          registry: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
          engine: 'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
          pool: 'CCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
          oracle: 'CDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        },
        readSource: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        keeperSecret: undefined,
      },
      keeper: { enabled: false, intervalMs: 30000, batchSize: 25 },
      server: {
        host: '127.0.0.1',
        port: 3000,
        logLevel: 'silent',
        rateLimitMax,
        rateLimitWindowMs: 1000,
        corsOrigin: '*',
      },
    });

    const config = testConfig();
    const gateway = new FakeGateway();
    const contracts = createContracts(gateway, config.soroban.addresses);
    registerRoutes(app, {
      gateway,
      contracts,
      addresses: config.soroban.addresses,
      network: 'testnet',
      keeper: undefined,
    });

    return app;
  }

  it('includes security headers in HTTP responses', async () => {
    const app = testApp();
    const res = await app.inject({ method: 'GET', url: '/health/live' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('serves OpenAPI specification and Swagger UI', async () => {
    const app = testApp();
    const spec = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toBe('3.0.3');

    const html = await app.inject({ method: 'GET', url: '/docs' });
    expect(html.statusCode).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toContain('SwaggerUIBundle');
  });

  it('enforces rate limits on API requests', async () => {
    const app = testApp(2);
    const r1 = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
    expect(r1.statusCode).toBe(200);
    expect(Number(r1.headers['x-ratelimit-remaining'])).toBe(1);

    const r2 = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
    expect(r2.statusCode).toBe(200);
    expect(Number(r2.headers['x-ratelimit-remaining'])).toBe(0);

    const r3 = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
    expect(r3.statusCode).toBe(429);
    expect(r3.json().error.code).toBe('rate_limit_exceeded');
  });
});

describe('Keeper cursor store persistence', () => {
  it('resumes from persistent cursor store across sweeps', async () => {
    const store = new MemoryCursorStore(5n);
    const keeper = new SettlementKeeper({
      registry: { policyCount: async () => 10n },
      engine: {
        evaluate: async (id) => ({
          policyId: id,
          status: 'Pending',
          indexValue: 100,
          readingTimestamp: 1000,
          payoutAmount: 0n,
        }),
        settlePolicy: async () => ({
          hash: 'abc',
          ledger: 1,
          outcome: { policyId: 1n, status: 'Pending', indexValue: 100, readingTimestamp: 1000, paidAmount: 0n },
        }),
      },
      intervalMs: 1000,
      batchSize: 2,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cursorStore: store,
    });

    const report = await keeper.sweep();
    expect(report.entries.map((e) => e.policyId)).toEqual([5n, 6n]);
    expect(await store.getCursor()).toBe(7n);
  });
});
