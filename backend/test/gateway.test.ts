/**
 * The gateway is the only module that talks to a Soroban node, and until now it
 * was the only one with no tests: every other suite replaces it with a fake
 * gateway, which is the right call for the routes and the keeper but leaves the
 * code that actually builds transactions unexercised.
 *
 * These drive it against a scripted node, so the branches that only exist here —
 * how a host error is classified, what happens when a submission is refused, how
 * long the poll loop waits — run for real.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  ContractCallError,
  RpcSorobanGateway,
  parseContractErrorCode,
  type SorobanArg,
} from '../src/contracts/gateway.js';
import { accountAddress, contractAddress } from './helpers/env.js';
import {
  ScriptedServer,
  failedTransaction,
  includedTransaction,
  missingTransaction,
  retval,
  sendResponse,
  simulationError,
  simulationSuccess,
} from './helpers/rpc.js';

const NETWORK = 'Test SDF Network ; September 2015';
const READ_SOURCE = accountAddress();
const CONTRACT = contractAddress();
const ARGS: SorobanArg[] = [{ type: 'u64', value: 7n }];
const CALL = { contractId: CONTRACT, method: 'get_policy', args: ARGS };

interface Options {
  readonly server: ScriptedServer;
  readonly keeper?: Keypair;
  readonly submissionTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function gateway(options: Options): RpcSorobanGateway {
  return new RpcSorobanGateway({
    rpcUrl: 'https://rpc.test',
    networkPassphrase: NETWORK,
    readSource: READ_SOURCE,
    server: options.server,
    keeper: options.keeper,
    submissionTimeoutMs: options.submissionTimeoutMs,
    sleep: options.sleep ?? (async () => undefined),
  });
}

/** Records how long the poll loop waited. */
function sleepRecorder(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe('contract error codes', () => {
  it('reads the code out of the host error a node reports', () => {
    // This is the string a real node returns for a typed contract error, and the
    // only thing standing between a 404 and a generic upstream failure.
    expect(parseContractErrorCode('HostError: Error(Contract, #12)')).toBe(12);
    expect(parseContractErrorCode('Error(Contract, #6)')).toBe(6);
  });

  it('reports nothing when the message carries no code', () => {
    expect(parseContractErrorCode('HostError: Error(WasmVm, MissingValue)')).toBeUndefined();
    expect(parseContractErrorCode('socket hang up')).toBeUndefined();
  });

  it('refuses a code too large to be one', () => {
    // Better to report an unclassifiable failure than to invent a meaning for a
    // number the contract cannot have assigned.
    expect(parseContractErrorCode('Error(Contract, #99999999999999999999)')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('reading a contract', () => {
  it('simulates the call and decodes the returned value', async () => {
    const server = new ScriptedServer().withSimulation(simulationSuccess(retval(7n)));

    const value = await gateway({ server }).read(CALL);

    expect(value).toBe(7n);
    expect(server.simulations).toHaveLength(1);
    // A read never reaches the submission path.
    expect(server.sent).toEqual([]);
    expect(server.polls).toEqual([]);
  });

  it('does not need a funded account to read', async () => {
    // Simulation ignores the sequence number, so a read must not spend a round
    // trip looking the source up — that is what keeps a keyless deployment able
    // to answer every query.
    const server = new ScriptedServer().withSimulation(simulationSuccess(retval(1n)));

    await gateway({ server }).read(CALL);

    expect(server.accounts).toEqual([]);
    expect(server.simulations[0]?.source).toBe(READ_SOURCE);
  });

  it('keeps the contract code when the host refused the call', async () => {
    const server = new ScriptedServer().withSimulation(
      simulationError('HostError: Error(Contract, #12)'),
    );

    const error = await gateway({ server })
      .read(CALL)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ContractCallError);
    expect((error as ContractCallError).contractCode).toBe(12);
    expect((error as ContractCallError).contractId).toBe(CONTRACT);
    expect((error as ContractCallError).method).toBe('get_policy');
  });

  it('reports a simulation that produced no value', async () => {
    const server = new ScriptedServer().withSimulation(simulationSuccess());

    const error = await gateway({ server })
      .read(CALL)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ContractCallError);
    expect((error as Error).message).toMatch(/no value/);
  });

  it('reports the latest ledger', async () => {
    await expect(gateway({ server: new ScriptedServer() }).latestLedger()).resolves.toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

describe('submitting a contract call', () => {
  it('refuses to submit without a signing key', async () => {
    const server = new ScriptedServer();
    const client = gateway({ server });

    expect(client.canSubmit).toBe(false);
    await expect(client.invoke(CALL)).rejects.toThrow(/no keeper key/);
    // Refused before building anything, rather than signed by nobody.
    expect(server.sent).toEqual([]);
    expect(server.accounts).toEqual([]);
  });

  it('signs with the keeper and waits for the transaction to be included', async () => {
    const keeper = Keypair.random();
    const { sleep, waits } = sleepRecorder();
    const server = new ScriptedServer()
      .withSend(sendResponse('PENDING', 'hash-1'))
      .withTransaction(missingTransaction('hash-1'), includedTransaction('hash-1', 42, retval(9n)));

    const result = await gateway({ server, keeper, sleep }).invoke(CALL);

    expect(result).toEqual({ hash: 'hash-1', ledger: 42, returnValue: 9n });
    // The transaction comes back from the node's own report of it, so the state
    // it describes and the transaction that caused it cannot disagree.
    expect(server.accounts).toEqual([keeper.publicKey()]);
    expect(server.signedBy(keeper, server.sent[0])).toBe(true);
    // Polled twice: not yet seen, then included. Waited exactly once between.
    expect(server.polls).toEqual(['hash-1', 'hash-1']);
    expect(waits).toHaveLength(1);
  });

  it('waits for a transaction the node has already seen', async () => {
    // `DUPLICATE` says the transaction is already in flight or already included,
    // so the only useful move is the same as for `PENDING`: poll for it. A node
    // that answers a retry this way would otherwise be treated as a rejection.
    const keeper = Keypair.random();
    const server = new ScriptedServer()
      .withSend(sendResponse('DUPLICATE', 'hash-5'))
      .withTransaction(includedTransaction('hash-5', 50));

    const result = await gateway({ server, keeper }).invoke(CALL);

    // No return value on this transaction: the caller gets an honest `undefined`
    // rather than a fabricated one.
    expect(result).toEqual({ hash: 'hash-5', ledger: 50, returnValue: undefined });
    expect(server.polls).toEqual(['hash-5']);
  });

  it('reports a transaction the node rejected outright', async () => {
    const keeper = Keypair.random();
    const server = new ScriptedServer().withSend(sendResponse('ERROR', 'hash-2'));

    const error = await gateway({ server, keeper })
      .invoke(CALL)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ContractCallError);
    expect((error as Error).message).toMatch(/rejected transaction hash-2/);
    // Nothing was queued, so nothing is polled for.
    expect(server.polls).toEqual([]);
  });

  it('reports a transaction the network included and failed', async () => {
    const keeper = Keypair.random();
    const server = new ScriptedServer()
      .withSend(sendResponse('PENDING', 'hash-3'))
      .withTransaction(failedTransaction('hash-3'));

    await expect(gateway({ server, keeper }).invoke(CALL)).rejects.toThrow(/hash-3 failed/);
  });

  it('gives up on a transaction that is never included', async () => {
    const keeper = Keypair.random();
    const { sleep, waits } = sleepRecorder();
    const server = new ScriptedServer()
      .withSend(sendResponse('PENDING', 'hash-4'))
      .withTransaction(missingTransaction('hash-4'));

    const error = await gateway({ server, keeper, sleep, submissionTimeoutMs: 0 })
      .invoke(CALL)
      .catch((cause: unknown) => cause);

    expect((error as Error).message).toMatch(/not included within 0ms/);
    // The budget was already spent, so the loop did not sleep first.
    expect(waits).toEqual([]);
    expect(server.polls).toEqual(['hash-4']);
  });

  it('keeps the contract code when preparing the transaction fails', async () => {
    // `prepareTransaction` simulates the call, so a contract rejection surfaces
    // here — before anything is signed — and it is the only place the routes can
    // learn that a policy is already settled.
    const keeper = Keypair.random();
    const server = new ScriptedServer().withPrepareError(
      new Error('HostError: Error(Contract, #7)'),
    );

    const error = await gateway({ server, keeper })
      .invoke(CALL)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ContractCallError);
    expect((error as ContractCallError).contractCode).toBe(7);
    expect(server.sent).toEqual([]);
  });
});
