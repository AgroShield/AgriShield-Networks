/**
 * The API client against a scripted `fetch`.
 *
 * This file runs in the node environment rather than under jsdom, so `Response`
 * is the real one and the client is exercised through the same interface a
 * browser would give it.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, describeFailure } from '../src/api/client';
import { ShapeError } from '../src/api/shape';
import { empty, html, json, respondWith, type RecordedRequest } from './helpers/http';

const BASE = 'https://api.test';

const WIRE_POLICY = {
  id: '7',
  farmer: 'GBZXQ4K7YQ2F6W5T3RZP4N6H2J5L8M3C9V1B7D4S6A8E2U5I0O3K',
  plotHash: 'ab'.repeat(32),
  cropType: 'maize',
  regionId: 'ng_kaduna',
  coverageStart: '1700000000',
  coverageEnd: '1705000000',
  triggerThreshold: '300',
  payoutAmount: '4000',
  premium: '1000',
  status: 'Active',
  createdAt: '1699000000',
  settledAt: '0',
};

const WIRE_HEALTH = {
  status: 'degraded',
  network: 'testnet',
  ledger: 99,
  contracts: { registry: 'C1', engine: 'C2', pool: 'C3', oracle: 'C4' },
  onChain: null,
  keeper: { enabled: false },
  reason: 'the engine on chain is wired to different contracts than this API is configured with',
};

const WIRE_KEEPER = {
  enabled: true,
  running: false,
  cursor: '3',
  totals: { swept: 5, settled: 1, expired: 2, failed: 0 },
  lastSweep: {
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_500,
    considered: 3,
    settled: 1,
    expired: 1,
    failed: 0,
    entries: [
      { policyId: '1', action: 'skipped', status: null, transactionHash: null, reason: null },
    ],
  },
};

function clientWith(handler: (url: string, init?: RequestInit) => Response): {
  client: ReturnType<typeof createApiClient>;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const client = createApiClient({ baseUrl: BASE, fetch: respondWith(handler, requests) });
  return { client, requests };
}

describe('requests', () => {
  it('reads a policy from its id', async () => {
    const { client, requests } = clientWith(() => json(WIRE_POLICY));

    const policy = await client.getPolicy('7');

    expect(requests[0]?.url).toBe(`${BASE}/policies/7`);
    expect(policy.id).toBe('7');
    expect(policy.status).toBe('Active');
  });

  it('filters the list by exactly the one field given', async () => {
    const { client, requests } = clientWith(() => json({ policyIds: [], total: 0, policies: [] }));

    await client.listPolicies({ farmer: 'GBZX', limit: 5 });
    await client.listPolicies({ region: 'ng_kaduna' });

    expect(requests[0]?.url).toBe(`${BASE}/policies?farmer=GBZX&limit=5`);
    // No empty `farmer=` is appended for the region search: the API answers a
    // 400 when both are present, and an empty string is present.
    expect(requests[1]?.url).toBe(`${BASE}/policies?region=ng_kaduna`);
  });

  it('submits a settlement with POST', async () => {
    const { client, requests } = clientWith(() =>
      json({
        transactionHash: 'hash-7',
        ledger: 51,
        outcome: {
          policyId: '7',
          status: 'Paid',
          indexValue: '120',
          readingTimestamp: '1700000000',
          paidAmount: '4000',
        },
      }),
    );

    const settled = await client.settle('7');

    expect(requests[0]).toMatchObject({ url: `${BASE}/settlements/7`, method: 'POST' });
    expect(settled.outcome.paidAmount).toBe('4000');
  });

  it('decodes the keeper status, including an absent sweep', async () => {
    const { client } = clientWith(() => json({ ...WIRE_KEEPER, lastSweep: null }));

    const keeper = await client.keeperStatus();

    expect(keeper.cursor).toBe('3');
    expect(keeper.totals.swept).toBe(5);
    expect(keeper.lastSweep).toBeNull();
  });
});

describe('failures', () => {
  it('reads the error envelope and keeps its code', async () => {
    const { client } = clientWith(() =>
      json({ error: { code: 'policy_not_found', message: 'no policy exists under that id' } }, 404),
    );

    const failure = await client.getPolicy('7').catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, code: 'policy_not_found' });
    expect(describeFailure(failure)).toBe('policy_not_found: no policy exists under that id');
  });

  it('reports a failure with no envelope as not the API\u2019s own', async () => {
    const { client } = clientWith(() => html(502));

    const failure = await client.keeperStatus().catch((cause: unknown) => cause);

    expect(failure).toMatchObject({ status: 502, code: 'unexpected_response' });
  });

  it('reports an unreachable API as status 0 rather than a server answer', async () => {
    const client = createApiClient({
      baseUrl: BASE,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    const failure = await client.health().catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).isOffline).toBe(true);
    // No code is invented for this: there was no answer to read one from.
    expect(describeFailure(failure)).toContain('could not be reached');
  });

  it('reports a success with no body rather than decoding undefined', async () => {
    const { client } = clientWith(() => empty(200));

    const failure = await client.getPolicy('7').catch((cause: unknown) => cause);

    expect(failure).toMatchObject({ status: 200, code: 'empty_response' });
  });

  it('fails loudly when a field arrives in the wrong form', async () => {
    // `id` as a number: the API promises a decimal string, and coercing would
    // turn a missing field into `NaN` somewhere further from the cause.
    const { client } = clientWith(() => json({ ...WIRE_POLICY, id: 7 }));

    await expect(client.getPolicy('7')).rejects.toBeInstanceOf(ShapeError);
  });

  it('names the field that moved', async () => {
    // The field is removed and its snake_case spelling added, which is what a
    // contract redeploy would look like: the decoder is expected to fail on the
    // field it wants rather than invent a value for it.
    const { payoutAmount, ...rest } = WIRE_POLICY;
    const { client } = clientWith(() => json({ ...rest, payout_amount: payoutAmount }));

    const failure = await client.getPolicy('7').catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ShapeError);
    expect((failure as Error).message).toContain('payoutAmount');
  });
});

describe('/health', () => {
  it('returns the report even when the status code says 503', async () => {
    // The endpoint uses 503 for both "the node is unreachable" and "this process
    // is wired to the wrong contracts", and in both cases the body is the
    // explanation. Treating the code as failure would discard it.
    const { client } = clientWith(() => json(WIRE_HEALTH, 503));

    const health = await client.health();

    expect(health.status).toBe('degraded');
    expect(health.reason).toContain('wired to different contracts');
    expect(health.keeper.enabled).toBe(false);
  });

  it('still raises an error envelope', async () => {
    const { client } = clientWith(() =>
      json({ error: { code: 'rpc_unavailable', message: 'the node is down' } }, 503),
    );

    const failure = await client.health().catch((cause: unknown) => cause);

    expect(failure).toMatchObject({ code: 'rpc_unavailable' });
  });

  it('rejects a 200 that is not a health report', async () => {
    const { client } = clientWith(() => html(200));

    await expect(client.health()).rejects.toBeInstanceOf(ShapeError);
  });
});
