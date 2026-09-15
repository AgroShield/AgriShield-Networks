/**
 * The one place that talks to a Soroban RPC node.
 *
 * Routes and the keeper depend on the {@link SorobanGateway} interface rather
 * than on the RPC client, so they can be exercised without a network and so the
 * distinction between the two ways of reaching a contract stays in one file:
 * reads are simulations that never leave the node, writes are prepared,
 * simulated, signed and then polled until the network includes them.
 */

import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type Keypair,
  type Transaction,
} from '@stellar/stellar-sdk';

/** Soroban types the backend passes as arguments. */
export type SorobanArgType = 'u32' | 'u64' | 'i128' | 'address' | 'symbol';

export interface SorobanArg {
  readonly type: SorobanArgType;
  readonly value: unknown;
}

/** A single call to a single contract function. */
export interface ContractCall {
  readonly contractId: string;
  readonly method: string;
  readonly args: readonly SorobanArg[];
}

export interface InvocationResult {
  /** Transaction hash, usable as a handle with any block explorer. */
  readonly hash: string;
  /** Ledger the transaction was included in. */
  readonly ledger: number;
  /**
   * The decoded contract return value, absent for a function that returns
   * nothing. Taking it from the transaction result rather than re-reading the
   * contract means a write and the state it reports are always consistent.
   */
  readonly returnValue: unknown;
}

export interface SorobanGateway {
  /** Simulates a read-only call and returns the decoded return value. */
  read(call: ContractCall): Promise<unknown>;
  /** Submits a state-changing call signed by the keeper key. */
  invoke(call: ContractCall): Promise<InvocationResult>;
  /** Latest ledger known to the node, used as a liveness probe. */
  latestLedger(): Promise<number>;
  /**
   * Whether this gateway holds a signing key.
   *
   * A deployment without one is a read-only API: it can answer every query but
   * must refuse to submit rather than fail with a confusing 500.
   */
  readonly canSubmit: boolean;
}

/**
 * Soroban reports contract failures inside a host error string such as
 * `HostError: Error(Contract, #6)`. The numeric code is the contract's own
 * error enum, which is what lets a route answer 404 for an unknown policy
 * instead of reporting every failure as a generic upstream problem.
 */
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

export function parseContractErrorCode(message: string): number | undefined {
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  const code = Number.parseInt(digits, 10);
  return Number.isSafeInteger(code) ? code : undefined;
}

/** A contract call the network refused. */
export class ContractCallError extends Error {
  readonly contractId: string;
  readonly method: string;
  /** The contract's own error code, when the message carried one. */
  readonly contractCode: number | undefined;

  constructor(
    contractId: string,
    method: string,
    message: string,
    contractCode?: number | undefined,
  ) {
    super(message);
    this.name = 'ContractCallError';
    this.contractId = contractId;
    this.method = method;
    this.contractCode = contractCode;
  }
}

export interface RpcGatewayOptions {
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  /**
   * Public key used as the source of read-only simulations.
   *
   * Simulation never evaluates a sequence number, so an unfunded reference is
   * enough to answer a query — the backend does not need a funded account just
   * to read.
   */
  readonly readSource: string;
  /** Required only to submit transactions. */
  readonly keeper?: Keypair | undefined;
  readonly submissionTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  /** Injected by tests so polling does not have to wait out real time. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SUBMISSION_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export class RpcSorobanGateway implements SorobanGateway {
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;
  private readonly readSource: string;
  private readonly keeper: Keypair | undefined;
  private readonly submissionTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RpcGatewayOptions) {
    this.server = new rpc.Server(options.rpcUrl, { allowHttp: options.rpcUrl.startsWith('http:') });
    this.networkPassphrase = options.networkPassphrase;
    this.readSource = options.readSource;
    this.keeper = options.keeper;
    this.submissionTimeoutMs = options.submissionTimeoutMs ?? DEFAULT_SUBMISSION_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get canSubmit(): boolean {
    return this.keeper !== undefined;
  }

  async read(call: ContractCall): Promise<unknown> {
    const simulation = await this.server.simulateTransaction(this.buildReadTransaction(call));

    if (rpc.Api.isSimulationError(simulation)) {
      throw new ContractCallError(
        call.contractId,
        call.method,
        simulation.error,
        parseContractErrorCode(simulation.error),
      );
    }
    if (!rpc.Api.isSimulationSuccess(simulation) || simulation.result === undefined) {
      throw new ContractCallError(
        call.contractId,
        call.method,
        'the simulation returned no value',
      );
    }

    return scValToNative(simulation.result.retval);
  }

  async invoke(call: ContractCall): Promise<InvocationResult> {
    const keeper = this.keeper;
    if (keeper === undefined) {
      throw new Error('no keeper key is configured, so transactions cannot be submitted');
    }

    const account = await this.server.getAccount(keeper.publicKey());
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.buildOperation(call))
      .setTimeout(30)
      .build();

    // `prepareTransaction` simulates the call and folds the footprint, the
    // resource fee and the authorisation into the envelope. Doing that by hand
    // is how submissions end up failing with opaque resource errors — and it
    // also means a contract rejection surfaces here, before anything is signed.
    let prepared: Transaction;
    try {
      prepared = await this.server.prepareTransaction(transaction);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ContractCallError(
        call.contractId,
        call.method,
        message,
        parseContractErrorCode(message),
      );
    }

    prepared.sign(keeper);
    const sent = await this.server.sendTransaction(prepared);

    if (sent.status === 'ERROR') {
      throw new ContractCallError(
        call.contractId,
        call.method,
        `the network rejected transaction ${sent.hash}`,
      );
    }

    return this.awaitInclusion(call, sent.hash);
  }

  async latestLedger(): Promise<number> {
    const response = await this.server.getLatestLedger();
    return response.sequence;
  }

  /** Polls until the transaction is included, fails, or the budget runs out. */
  private async awaitInclusion(call: ContractCall, hash: string): Promise<InvocationResult> {
    const deadline = Date.now() + this.submissionTimeoutMs;

    for (;;) {
      const result = await this.server.getTransaction(hash);

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          hash,
          ledger: result.ledger,
          returnValue: result.returnValue === undefined ? undefined : scValToNative(result.returnValue),
        };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        // The result XDR is the authoritative explanation and is not cheap to
        // parse here, so the hash is reported as the handle for debugging.
        throw new ContractCallError(
          call.contractId,
          call.method,
          `transaction ${hash} failed`,
        );
      }
      if (Date.now() >= deadline) {
        throw new ContractCallError(
          call.contractId,
          call.method,
          `transaction ${hash} was not included within ${this.submissionTimeoutMs}ms`,
        );
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  private buildReadTransaction(call: ContractCall): Transaction {
    const source = new Account(this.readSource, '0');
    return new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.buildOperation(call))
      .setTimeout(30)
      .build();
  }

  private buildOperation(call: ContractCall): ReturnType<Contract['call']> {
    const contract = new Contract(call.contractId);
    return contract.call(
      call.method,
      ...call.args.map((arg) => nativeToScVal(arg.value, { type: arg.type })),
    );
  }
}
