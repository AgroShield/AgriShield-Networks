import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { createContracts } from '../src/contracts/clients.js';
import { ContractCallError } from '../src/contracts/gateway.js';
import { SettlementKeeper } from '../src/keeper/keeper.js';
import { createApp, registerRoutes } from '../src/server.js';
import { accountAddress, contractAddress, testConfig } from './helpers/env.js';
import { FakeGateway, wirePolicy } from './helpers/fakes.js';
import { silentLogger } from './helpers/loggers.js';

/** A `Pending` evaluation, for the read-only keeper status test. */
function evaluation(policyId: bigint, status: 'Pending' | 'Paid' | 'Expired') {
  return {
    policyId,
    status,
    indexValue: 0n,
    readingTimestamp: 0n,
    payoutAmount: 0n,
  };
}

interface Built {
  readonly app: FastifyInstance;
  readonly gateway: FakeGateway;
}

function buildApp(gateway: FakeGateway, keeper?: SettlementKeeper): Built {
  const config = testConfig();
  const contracts = createContracts(gateway, config.soroban.addresses);
  const app = createApp(config);
  registerRoutes(app, {
    gateway,
    contracts,
    addresses: config.soroban.addresses,
    network: 'testnet',
    keeper,
  });
  return { app, gateway };
}

/** A gateway whose engine reports the configured wiring, so /health is ok. */
function healthyGateway(): FakeGateway {
  const config = testConfig();
  return new FakeGateway().withRead('contracts', {
    policy_registry: config.soroban.addresses.registry,
    premium_pool: config.soroban.addresses.pool,
    oracle: config.soroban.addresses.oracle,
  });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('reports ok when the node answers and the wiring matches', async () => {
    const { app } = buildApp(healthyGateway());

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.ledger).toBe(99);
    expect(body.reason).toBeNull();
    await app.close();
  });

  it('degrades when the engine settles against different contracts', async () => {
    const gateway = new FakeGateway().withRead('contracts', {
      policy_registry: contractAddress(11),
      premium_pool: contractAddress(12),
      oracle: contractAddress(13),
    });
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'GET', url: '/health' });

    // Answering queries about a book the engine does not settle against would
    // be confidently wrong, so this must not read as healthy.
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.reason).toMatch(/different contracts/);
    await app.close();
  });

  it('reports down when the node cannot be reached', async () => {
    const gateway = healthyGateway().withLedgerError(new Error('connect ECONNREFUSED'));
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('down');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

describe('GET /policies/:policyId', () => {
  it('serialises chain integers as strings', async () => {
    const gateway = new FakeGateway().withRead('get_policy', wirePolicy());
    const { app, gateway: received } = buildApp(gateway);

    const response = await app.inject({ method: 'GET', url: '/policies/7' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: '7',
      payoutAmount: '4000',
      premium: '1000',
      status: 'Active',
    });
    expect(received.reads[0]?.args[0]).toMatchObject({ type: 'u64', value: 7n });
    await app.close();
  });

  it('answers 404 when the registry does not know the id', async () => {
    const gateway = new FakeGateway().withReadError(
      'get_policy',
      new ContractCallError('C1', 'get_policy', 'Error(Contract, #12)', 12),
    );
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'GET', url: '/policies/404' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'policy_not_found' } });
    await app.close();
  });

  it('rejects a policy id that is not a number', async () => {
    const { app } = buildApp(new FakeGateway());

    const response = await app.inject({ method: 'GET', url: '/policies/abc' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    await app.close();
  });
});

describe('GET /policies', () => {
  it('requires exactly one filter', async () => {
    const { app } = buildApp(new FakeGateway());

    const neither = await app.inject({ method: 'GET', url: '/policies' });
    const both = await app.inject({
      method: 'GET',
      url: `/policies?farmer=${accountAddress()}&region=ng_kaduna`,
    });

    expect(neither.statusCode).toBe(400);
    expect(both.statusCode).toBe(400);
    expect(neither.json()).toMatchObject({ error: { code: 'invalid_query' } });
    await app.close();
  });

  it('lists every id and hydrates the newest ones first', async () => {
    const gateway = new FakeGateway()
      .withRead('get_farmer_policies', [1n, 2n, 3n])
      .withRead('get_policy', wirePolicy());
    const { app } = buildApp(gateway);

    const response = await app.inject({
      method: 'GET',
      url: `/policies?farmer=${accountAddress()}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      policyIds: ['1', '2', '3'],
      total: 3,
    });
    expect(response.json().policies).toHaveLength(2);
    // The registry returns ids oldest first, so the useful slice is the tail.
    const hydrated = gateway.reads
      .filter((call) => call.method === 'get_policy')
      .map((call) => call.args[0]?.value);
    expect(hydrated).toEqual([3n, 2n]);
    await app.close();
  });

  it('rejects a limit outside the accepted range', async () => {
    const { app } = buildApp(new FakeGateway());

    const response = await app.inject({
      method: 'GET',
      url: `/policies?farmer=${accountAddress()}&limit=1000`,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /policies/:policyId/settlement', () => {
  it('previews what settlement would do', async () => {
    const gateway = new FakeGateway().withRead('evaluate', {
      policy_id: 7n,
      status: 0,
      index_value: 120n,
      reading_timestamp: 1_700_000_000n,
      payout_amount: 4_000n,
    });
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'GET', url: '/policies/7/settlement' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      policyId: '7',
      status: 'Paid',
      indexValue: '120',
      readingTimestamp: '1700000000',
      payoutAmount: '4000',
    });
    // A preview must not submit anything.
    expect(gateway.writes).toEqual([]);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

describe('POST /settlements/:policyId', () => {
  it('submits a settlement and returns the transaction', async () => {
    const gateway = new FakeGateway().withWrite('settle_policy', {
      hash: 'abc123',
      ledger: 51,
      returnValue: {
        policy_id: 7n,
        status: 0,
        index_value: 120n,
        reading_timestamp: 1_700_000_000n,
        paid_amount: 4_000n,
      },
    });
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'POST', url: '/settlements/7' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      transactionHash: 'abc123',
      ledger: 51,
      outcome: {
        policyId: '7',
        status: 'Paid',
        indexValue: '120',
        readingTimestamp: '1700000000',
        paidAmount: '4000',
      },
    });
    await app.close();
  });

  it('refuses to submit when no key is configured', async () => {
    const gateway = new FakeGateway();
    gateway.canSubmit = false;
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'POST', url: '/settlements/7' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'keeper_disabled' } });
    expect(gateway.writes).toEqual([]);
    await app.close();
  });

  it('maps a contract rejection onto a conflict', async () => {
    const gateway = new FakeGateway().withWriteError(
      'settle_policy',
      new ContractCallError('C1', 'settle_policy', 'Error(Contract, #7)', 7),
    );
    const { app } = buildApp(gateway);

    const response = await app.inject({ method: 'POST', url: '/settlements/7' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'policy_not_active' } });
    await app.close();
  });
});

describe('GET /settlements/keeper', () => {
  it('reports the keeper as disabled in a read-only deployment', async () => {
    const { app } = buildApp(new FakeGateway());

    const response = await app.inject({ method: 'GET', url: '/settlements/keeper' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: false, running: false, cursor: '1' });
    await app.close();
  });

  it('reports the keeper status when one is running', async () => {
    const keeper = new SettlementKeeper({
      registry: { policyCount: async (): Promise<bigint> => 3n },
      engine: {
        evaluate: async (policyId: bigint) => ({ ...evaluation(policyId, 'Pending') }),
        settlePolicy: async (): Promise<never> => {
          throw new Error('nothing is due in this test');
        },
      },
      intervalMs: 1_000,
      batchSize: 1,
      logger: silentLogger,
      now: () => 1_000,
    });
    const { app } = buildApp(new FakeGateway(), keeper);

    const before = await app.inject({ method: 'GET', url: '/settlements/keeper' });
    await keeper.sweep();
    const after = await app.inject({ method: 'GET', url: '/settlements/keeper' });

    expect(before.json()).toMatchObject({
      enabled: true,
      running: false,
      cursor: '1',
      lastSweep: null,
    });
    // One policy examined, and the cursor moved on so the next sweep takes the
    // following one.
    expect(after.json()).toMatchObject({ cursor: '2' });
    expect(after.json().lastSweep).toMatchObject({ considered: 1 });
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------

describe('unknown routes', () => {
  it('answer with the standard error body', async () => {
    const { app } = buildApp(new FakeGateway());

    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
    await app.close();
  });
});
