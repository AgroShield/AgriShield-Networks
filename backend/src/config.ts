/**
 * Environment configuration.
 *
 * The contract addresses and the RPC endpoint have no safe defaults: a backend
 * pointed at the wrong registry would answer confidently and wrongly. A
 * misconfigured deployment therefore fails at boot with a message naming the
 * variable at fault, rather than at the first request that happens to need it.
 */

import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';

import type { ContractAddresses } from './contracts/addresses.js';

/** Networks this backend knows by name, so a passphrase need not be typed out. */
const KNOWN_NETWORKS: Readonly<Record<string, string>> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
  local: Networks.STANDALONE,
};

export interface SorobanSettings {
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  readonly addresses: ContractAddresses;
  /**
   * Public key used as the source of read-only simulations. Simulation ignores
   * the sequence number, so this account does not need to exist — or to hold
   * anything — for the API to answer a query.
   */
  readonly readSource: string;
  /** Present only when the backend is allowed to submit transactions. */
  readonly keeperSecret: string | undefined;
}

export interface KeeperSettings {
  readonly enabled: boolean;
  readonly intervalMs: number;
  /** How many of the most recent policies one sweep considers. */
  readonly batchSize: number;
}

export interface ServerSettings {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
}

export interface AppConfig {
  readonly soroban: SorobanSettings;
  readonly keeper: KeeperSettings;
  readonly server: ServerSettings;
}

/** A configuration problem, reported before the server starts listening. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === '') {
    throw new ConfigError(`${name} is required but was not set`);
  }
  return value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * A contract id, checked to be a real `C...` strkey.
 *
 * Addresses are pasted by hand and truncated pastes are common, so this is
 * caught at boot rather than as an opaque simulation failure on the first
 * request that touches the contract.
 */
function contractId(env: Env, name: string): string {
  const value = required(env, name);
  if (!StrKey.isValidContract(value)) {
    throw new ConfigError(`${name} is not a contract id; expected a C... strkey`);
  }
  return value;
}

/** An account id, checked to be a real `G...` strkey. */
function accountId(name: string, value: string): string {
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new ConfigError(`${name} is not an account id; expected a G... strkey`);
  }
  return value;
}

function integerWithin(
  env: Env,
  name: string,
  bounds: { readonly fallback: number; readonly min: number; readonly max: number },
): number {
  const raw = optional(env, name);
  if (raw === undefined) return bounds.fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ConfigError(`${name} must be an integer but was ${JSON.stringify(raw)}`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new ConfigError(`${name} must be between ${bounds.min} and ${bounds.max} but was ${value}`);
  }
  return value;
}

function booleanFlag(env: Env, name: string, fallback: boolean): boolean {
  const raw = optional(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  throw new ConfigError(`${name} must be a boolean but was ${JSON.stringify(raw)}`);
}

/**
 * Reads and validates the whole configuration.
 *
 * Throws {@link ConfigError} listing the offending variable, so a bad deploy
 * fails at boot with the reason instead of at the first settlement.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const network = optional(env, 'SOROBAN_NETWORK') ?? 'testnet';
  const passphrase = optional(env, 'SOROBAN_NETWORK_PASSPHRASE') ?? KNOWN_NETWORKS[network];
  if (passphrase === undefined) {
    const known = Object.keys(KNOWN_NETWORKS).join(', ');
    throw new ConfigError(
      `SOROBAN_NETWORK must be one of ${known}, or SOROBAN_NETWORK_PASSPHRASE must be set (got ${JSON.stringify(network)})`,
    );
  }

  const keeperSecret = optional(env, 'KEEPER_SECRET_KEY');
  let keeperKeypair: Keypair | undefined;
  if (keeperSecret !== undefined) {
    try {
      keeperKeypair = Keypair.fromSecret(keeperSecret);
    } catch {
      // Never echo the value: it is a signing key and may be a real one typed
      // into the wrong environment.
      throw new ConfigError('KEEPER_SECRET_KEY is not a valid Stellar secret key');
    }
  }

  // Checked in the order an operator would fill them in, so the first problem
  // reported is the first one they would look at.
  const rpcUrl = required(env, 'SOROBAN_RPC_URL');
  const addresses = {
    registry: contractId(env, 'POLICY_REGISTRY_CONTRACT_ID'),
    engine: contractId(env, 'PAYOUT_ENGINE_CONTRACT_ID'),
    pool: contractId(env, 'PREMIUM_POOL_CONTRACT_ID'),
    oracle: contractId(env, 'ORACLE_ADAPTER_CONTRACT_ID'),
  };

  const readSourceCandidate = optional(env, 'SOROBAN_READ_SOURCE') ?? keeperKeypair?.publicKey();
  if (readSourceCandidate === undefined) {
    throw new ConfigError(
      'SOROBAN_READ_SOURCE is required when no keeper key is configured, because read-only calls still need a source account',
    );
  }
  const readSource = accountId('SOROBAN_READ_SOURCE', readSourceCandidate);

  return {
    soroban: {
      rpcUrl,
      networkPassphrase: passphrase,
      addresses,
      readSource,
      keeperSecret,
    },
    keeper: {
      // A configured key is the signal that this process may submit. The flag
      // exists to turn the keeper off temporarily without destroying the key.
      enabled: keeperKeypair !== undefined && booleanFlag(env, 'KEEPER_ENABLED', true),
      intervalMs: integerWithin(env, 'KEEPER_INTERVAL_MS', {
        fallback: 30_000,
        min: 1_000,
        max: 3_600_000,
      }),
      batchSize: integerWithin(env, 'KEEPER_BATCH_SIZE', { fallback: 25, min: 1, max: 500 }),
    },
    server: {
      host: optional(env, 'HOST') ?? '0.0.0.0',
      port: integerWithin(env, 'PORT', { fallback: 3000, min: 1, max: 65_535 }),
      logLevel: optional(env, 'LOG_LEVEL') ?? 'info',
    },
  };
}
