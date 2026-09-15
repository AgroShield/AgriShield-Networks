import { describe, expect, it } from 'vitest';

import {
  PolicyRegistry,
  PremiumPool,
  createContracts,
} from '../src/contracts/clients.js';
import { ContractCallError } from '../src/contracts/gateway.js';
import {
  DecodeError,
  decodeEngineContracts,
  decodePolicy,
  decodeSettlementOutcome,
  decodeTriggerEvaluation,
} from '../src/contracts/types.js';
import { AppError } from '../src/errors.js';
import { contractAddress } from './helpers/env.js';
import { FakeGateway, wirePolicy } from './helpers/fakes.js';

describe('policy decoding', () => {
  it('maps the wire shape onto the domain model', () => {
    const policy = decodePolicy(wirePolicy());

    expect(policy.id).toBe(7n);
    expect(policy.regionId).toBe('ng_kaduna');
    expect(policy.payoutAmount).toBe(4_000n);
    // A status discriminant of 0 is `Active`, not a number the caller has to
    // know about.
    expect(policy.status).toBe('Active');
    // Bytes become hex so they survive JSON.
    expect(policy.plotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads the terminal statuses off their discriminants', () => {
    expect(decodePolicy(wirePolicy({ status: 1 })).status).toBe('Settled');
    expect(decodePolicy(wirePolicy({ status: 2 })).status).toBe('Expired');
    expect(decodePolicy(wirePolicy({ status: 3 })).status).toBe('Cancelled');
  });

  it('refuses a status this build has never heard of', () => {
    // A contract that grew a fourth status would otherwise be silently coerced.
    expect(() => decodePolicy(wirePolicy({ status: 4 }))).toThrow(DecodeError);
  });

  it('refuses a renamed field rather than inventing a value', () => {
    const renamed = wirePolicy();
    renamed['payoutAmount'] = renamed['payout_amount'];
    delete renamed['payout_amount'];

    expect(() => decodePolicy(renamed)).toThrow(/payout_amount/);
  });

  it('accepts a narrow integer where a wide one was expected', () => {
    // A contract change from u64 to u32 should narrow the API, not break it.
    expect(decodePolicy(wirePolicy({ id: 12 })).id).toBe(12n);
  });

  it('decodes settlement outcomes and trigger evaluations', () => {
    expect(
      decodeSettlementOutcome({
        policy_id: 3n,
        status: 0,
        index_value: 120n,
        reading_timestamp: 1_700_000_000n,
        paid_amount: 4_000n,
      }).status,
    ).toBe('Paid');

    expect(
      decodeTriggerEvaluation({
        policy_id: 3n,
        status: 2,
        index_value: 0n,
        reading_timestamp: 0n,
        payout_amount: 0n,
      }).status,
    ).toBe('Pending');
  });

  it('decodes the engine wiring', () => {
    const wiring = decodeEngineContracts({
      policy_registry: contractAddress(),
      premium_pool: contractAddress(),
      oracle: contractAddress(),
    });

    expect(wiring.policyRegistry).toHaveLength(56);
  });
});

describe('contract error mapping', () => {
  it('turns an unknown policy into a 404', async () => {
    const gateway = new FakeGateway().withReadError(
      'get_policy',
      new ContractCallError('C1', 'get_policy', 'HostError: Error(Contract, #12)', 12),
    );
    const registry = new PolicyRegistry(gateway, contractAddress());

    const error = await registry.getPolicy(1n).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
    expect((error as AppError).code).toBe('policy_not_found');
  });

  it('turns a policy that has left the book into a 409', async () => {
    const gateway = new FakeGateway().withReadError(
      'get_policy',
      new ContractCallError('C1', 'get_policy', 'Error(Contract, #13)', 13),
    );

    const error = await new PolicyRegistry(gateway, contractAddress())
      .getPolicy(1n)
      .catch((cause: unknown) => cause);

    expect((error as AppError).statusCode).toBe(409);
    expect((error as AppError).code).toBe('policy_not_active');
  });

  it('reports a contract code with no agreed meaning as a 502 that names it', async () => {
    const gateway = new FakeGateway().withReadError(
      'get_policy',
      new ContractCallError('C1', 'get_policy', 'Error(Contract, #99)', 99),
    );

    const error = await new PolicyRegistry(gateway, contractAddress())
      .getPolicy(1n)
      .catch((cause: unknown) => cause);

    expect((error as AppError).statusCode).toBe(502);
    expect((error as AppError).code).toBe('contract_call_failed');
    expect((error as AppError).details).toMatchObject({ contractCode: 99 });
  });

  it('reports an undecodable value as a shape mismatch, not a caller error', async () => {
    const gateway = new FakeGateway().withRead('get_policy', { unexpected: 'shape' });

    const error = await new PolicyRegistry(gateway, contractAddress())
      .getPolicy(1n)
      .catch((cause: unknown) => cause);

    expect((error as AppError).statusCode).toBe(502);
    expect((error as AppError).code).toBe('contract_shape_changed');
  });

  it('reports a transport failure as unavailable', async () => {
    const gateway = new FakeGateway().withReadError('reserves', new Error('socket hang up'));

    const error = await new PremiumPool(gateway, contractAddress())
      .reserves()
      .catch((cause: unknown) => cause);

    expect((error as AppError).statusCode).toBe(503);
    expect((error as AppError).code).toBe('rpc_unavailable');
  });
});

describe('soroban argument types', () => {
  it('passes a policy id as a u64 and a farmer as an address', async () => {
    const gateway = new FakeGateway();
    const addresses = {
      registry: contractAddress(),
      engine: contractAddress(),
      pool: contractAddress(),
      oracle: contractAddress(),
    };
    const contracts = createContracts(gateway, addresses);

    gateway.withRead('get_policy', wirePolicy());
    gateway.withRead('get_farmer_policies', []);
    await contracts.registry.getPolicy(7n);
    await contracts.registry.farmerPolicies('GFarmer');

    expect(gateway.reads[0]).toMatchObject({
      contractId: addresses.registry,
      method: 'get_policy',
      args: [{ type: 'u64', value: 7n }],
    });
    expect(gateway.reads[1]?.args[0]).toMatchObject({ type: 'address', value: 'GFarmer' });
  });

  it('passes a region as a symbol', async () => {
    const gateway = new FakeGateway().withRead('has_reading', true);
    const contracts = createContracts(gateway, {
      registry: contractAddress(),
      engine: contractAddress(),
      pool: contractAddress(),
      oracle: contractAddress(),
    });

    await contracts.oracle.hasReading('ng_kaduna');

    expect(gateway.reads[0]?.args[0]).toMatchObject({ type: 'symbol', value: 'ng_kaduna' });
  });
});
