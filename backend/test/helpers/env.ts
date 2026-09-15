/**
 * Environment fixtures for tests.
 *
 * Built from generated strkeys rather than hardcoded ones, so the fixtures stay
 * valid as the configuration's format checks tighten.
 */

import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';

import { loadConfig, type AppConfig } from '../../src/config.js';

/**
 * A well-formed contract id.
 *
 * Deterministic per seed so a test can tell two contracts apart — which the
 * health check's wiring comparison depends on.
 */
export function contractAddress(seed = 7): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

/** A well-formed account id. */
export function accountAddress(): string {
  return Keypair.random().publicKey();
}

/** The passphrase `SOROBAN_NETWORK=testnet` resolves to. */
export const TESTNET_PASSPHRASE = Networks.TESTNET;

/** The environment a test app is built from. `silent` keeps test output clean. */
export function testEnv(): Record<string, string> {
  return {
    SOROBAN_RPC_URL: 'https://rpc.test',
    SOROBAN_NETWORK: 'testnet',
    POLICY_REGISTRY_CONTRACT_ID: contractAddress(1),
    PAYOUT_ENGINE_CONTRACT_ID: contractAddress(2),
    PREMIUM_POOL_CONTRACT_ID: contractAddress(3),
    ORACLE_ADAPTER_CONTRACT_ID: contractAddress(4),
    SOROBAN_READ_SOURCE: accountAddress(),
    LOG_LEVEL: 'silent',
  };
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ ...testEnv(), ...overrides });
}
