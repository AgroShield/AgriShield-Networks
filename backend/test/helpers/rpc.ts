/**
 * A scripted Soroban RPC node.
 *
 * The gateway is the one part of the backend that talks to a real network, so it
 * is also the part whose branches a fake `SorobanGateway` cannot reach: how a
 * simulation error is classified, what happens when a submission is refused, how
 * long the poll loop waits before giving up. This stands in for the RPC client
 * so those branches run for real.
 *
 * The response factories below populate only the fields the gateway reads. A
 * genuine `simulateTransaction` response also carries XDR plumbing — a
 * `SorobanDataBuilder`, ledger metadata, diagnostic events — that this layer
 * never looks at, and reproducing it here would mean asserting on the SDK's
 * encoding rather than on the gateway's behaviour. The casts are confined to
 * this file for that reason.
 */

import {
  Account,
  SorobanDataBuilder,
  nativeToScVal,
  rpc,
  type Keypair,
  type Transaction,
} from '@stellar/stellar-sdk';

import type { SorobanRpcServer } from '../../src/contracts/gateway.js';

/** A simulation that succeeded and returned `retval`, when one was produced. */
export function simulationSuccess(retval?: unknown): rpc.Api.SimulateTransactionResponse {
  return {
    id: '1',
    latestLedger: 10,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: retval === undefined ? undefined : { auth: [], retval },
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

/** A simulation the host refused, carrying the message a node would return. */
export function simulationError(error: string): rpc.Api.SimulateTransactionResponse {
  return {
    id: '1',
    latestLedger: 10,
    events: [],
    _parsed: true,
    error,
  } as unknown as rpc.Api.SimulateTransactionErrorResponse;
}

/** A successful ledger lookup. Only the sequence is read. */
export function ledgerResponse(sequence: number): rpc.Api.GetLatestLedgerResponse {
  return { id: '1', sequence, protocolVersion: '22', closeTime: '0' } as unknown as rpc.Api.GetLatestLedgerResponse;
}

/** A transaction the network included, with its return value decoded from XDR. */
export function includedTransaction(
  hash: string,
  ledger: number,
  retval?: unknown,
): rpc.Api.GetTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    txHash: hash,
    ledger,
    latestLedger: ledger,
    latestLedgerCloseTime: 0,
    oldestLedger: 1,
    oldestLedgerCloseTime: 0,
    createdAt: 0,
    applicationOrder: 0,
    feeBump: false,
    envelopeXdr: undefined,
    resultXdr: undefined,
    resultMetaXdr: undefined,
    events: { contract: [], diagnostic: [], transaction: [] },
    returnValue: retval,
  } as unknown as rpc.Api.GetSuccessfulTransactionResponse;
}

/** A transaction the network included and then failed. */
export function failedTransaction(hash: string): rpc.Api.GetTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.FAILED,
    txHash: hash,
    ledger: 11,
    latestLedger: 11,
    latestLedgerCloseTime: 0,
    oldestLedger: 1,
    oldestLedgerCloseTime: 0,
    createdAt: 0,
    applicationOrder: 0,
    feeBump: false,
    envelopeXdr: undefined,
    resultXdr: undefined,
    resultMetaXdr: undefined,
    events: { contract: [], diagnostic: [], transaction: [] },
  } as unknown as rpc.Api.GetFailedTransactionResponse;
}

/** A transaction the node has not seen (yet). */
export function missingTransaction(hash: string): rpc.Api.GetTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    txHash: hash,
    latestLedger: 10,
    latestLedgerCloseTime: 0,
    oldestLedger: 1,
    oldestLedgerCloseTime: 0,
  } as unknown as rpc.Api.GetMissingTransactionResponse;
}

/** The node's answer to a submission, before any polling. */
export function sendResponse(
  status: rpc.Api.SendTransactionStatus,
  hash: string,
): rpc.Api.SendTransactionResponse {
  return { status, hash, latestLedger: 10, latestLedgerCloseTime: 0 };
}

/** Wraps a domain value the way a contract return would arrive. */
export function retval(value: unknown): unknown {
  return nativeToScVal(value, { type: 'u64' });
}

/**
 * Scripted responses, keyed by the call the gateway makes.
 *
 * Every method a test does not script throws, so a gateway change that starts
 * calling something new fails loudly instead of being answered by an empty
 * default.
 */
export class ScriptedServer implements SorobanRpcServer {
  readonly simulations: Transaction[] = [];
  readonly prepared: Transaction[] = [];
  readonly sent: Transaction[] = [];
  readonly polls: string[] = [];
  readonly accounts: string[] = [];

  private readonly simulationResponses: rpc.Api.SimulateTransactionResponse[] = [];
  private readonly sendResponses: rpc.Api.SendTransactionResponse[] = [];
  private readonly transactionResponses: rpc.Api.GetTransactionResponse[] = [];
  private prepareError: unknown;
  accountSequence = '1';

  /** Queues the next simulation result; the last one repeats. */
  withSimulation(...responses: rpc.Api.SimulateTransactionResponse[]): this {
    this.simulationResponses.push(...responses);
    return this;
  }

  withSend(...responses: rpc.Api.SendTransactionResponse[]): this {
    this.sendResponses.push(...responses);
    return this;
  }

  withTransaction(...responses: rpc.Api.GetTransactionResponse[]): this {
    this.transactionResponses.push(...responses);
    return this;
  }

  withPrepareError(cause: unknown): this {
    this.prepareError = cause;
    return this;
  }

  async simulateTransaction(
    transaction: Transaction,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    this.simulations.push(transaction);
    return this.next(this.simulationResponses, 'simulateTransaction');
  }

  async prepareTransaction(transaction: Transaction): Promise<Transaction> {
    this.prepared.push(transaction);
    if (this.prepareError !== undefined) throw this.prepareError;
    return transaction;
  }

  async sendTransaction(transaction: Transaction): Promise<rpc.Api.SendTransactionResponse> {
    this.sent.push(transaction);
    return this.next(this.sendResponses, 'sendTransaction');
  }

  async getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    this.polls.push(hash);
    return this.next(this.transactionResponses, 'getTransaction');
  }

  async getAccount(publicKey: string): Promise<Account> {
    this.accounts.push(publicKey);
    return new Account(publicKey, this.accountSequence);
  }

  async getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return ledgerResponse(99);
  }

  /**
   * Whether the transaction carries this keypair's signature over its hash.
   *
   * The hash is computed from the envelope's network passphrase, so a signature
   * checking out here also proves the transaction was built for the network the
   * gateway was configured with.
   */
  signedBy(keypair: Keypair, transaction: Transaction | undefined): boolean {
    if (transaction === undefined) return false;
    return transaction.signatures.some((signature) =>
      keypair.verify(transaction.hash(), signature.signature),
    );
  }

  /** Consumes a queued response, holding the last one so a poll loop terminates. */
  private next<T>(queue: T[], method: string): T {
    if (queue.length === 0) {
      throw new Error(`test did not script a response for ${method}`);
    }
    return queue.length === 1 ? (queue[0] as T) : (queue.shift() as T);
  }
}
