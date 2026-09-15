import { Keypair, Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';
import { TESTNET_PASSPHRASE, accountAddress, testEnv } from './helpers/env.js';

describe('loadConfig', () => {
  it('fills in defaults for a minimal environment', () => {
    const config = loadConfig(testEnv());

    expect(config.soroban.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.port).toBe(3000);
    expect(config.keeper.enabled).toBe(false);
    expect(config.keeper.intervalMs).toBe(30_000);
    expect(config.keeper.batchSize).toBe(25);
  });

  it('names the missing variable rather than failing later', () => {
    const env = testEnv();
    delete env.SOROBAN_RPC_URL;

    expect(() => loadConfig(env)).toThrow(/SOROBAN_RPC_URL is required/);
  });

  it('rejects a contract id that is not a strkey', () => {
    const env = { ...testEnv(), POLICY_REGISTRY_CONTRACT_ID: 'Ctruncated' };

    expect(() => loadConfig(env)).toThrow(/POLICY_REGISTRY_CONTRACT_ID is not a contract id/);
  });

  it('rejects a truncated read source', () => {
    const env = { ...testEnv(), SOROBAN_READ_SOURCE: accountAddress().slice(0, 40) };

    expect(() => loadConfig(env)).toThrow(/SOROBAN_READ_SOURCE is not an account id/);
  });

  it('resolves known network names to their passphrases', () => {
    const config = loadConfig({ ...testEnv(), SOROBAN_NETWORK: 'mainnet' });

    expect(config.soroban.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it('rejects an unknown network name when no passphrase is given', () => {
    const env = { ...testEnv(), SOROBAN_NETWORK: 'moonnet' };

    expect(() => loadConfig(env)).toThrow(/SOROBAN_NETWORK must be one of/);
  });

  it('accepts an explicit passphrase for a network it does not know', () => {
    const config = loadConfig({
      ...testEnv(),
      SOROBAN_NETWORK: 'moonnet',
      SOROBAN_NETWORK_PASSPHRASE: 'Moonnet ; September 2026',
    });

    expect(config.soroban.networkPassphrase).toBe('Moonnet ; September 2026');
  });

  it('enables the keeper when a signing key is configured', () => {
    const config = loadConfig({ ...testEnv(), KEEPER_SECRET_KEY: Keypair.random().secret() });

    expect(config.keeper.enabled).toBe(true);
    expect(config.soroban.keeperSecret).toBeDefined();
  });

  it('falls back to the keeper public key for reads', () => {
    const keypair = Keypair.random();
    const env = testEnv();
    delete env.SOROBAN_READ_SOURCE;

    const config = loadConfig({ ...env, KEEPER_SECRET_KEY: keypair.secret() });

    expect(config.soroban.readSource).toBe(keypair.publicKey());
  });

  it('requires a read source when there is no keeper key', () => {
    const env = testEnv();
    delete env.SOROBAN_READ_SOURCE;

    expect(() => loadConfig(env)).toThrow(/SOROBAN_READ_SOURCE is required/);
  });

  it('rejects a secret key that is not a key, without echoing it', () => {
    let caught: unknown;
    try {
      loadConfig({ ...testEnv(), KEEPER_SECRET_KEY: 'hunter2' });
    } catch (cause) {
      caught = cause;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    // A signing key typed into the wrong environment must not end up in a log.
    expect((caught as Error).message).not.toContain('hunter2');
  });

  it('can pause the keeper without removing the key', () => {
    const config = loadConfig({
      ...testEnv(),
      KEEPER_SECRET_KEY: Keypair.random().secret(),
      KEEPER_ENABLED: 'false',
    });

    expect(config.keeper.enabled).toBe(false);
    expect(config.soroban.keeperSecret).toBeDefined();
  });

  it('bounds numeric settings and reports the range', () => {
    expect(() => loadConfig({ ...testEnv(), PORT: '70000' })).toThrow(/PORT must be between/);
    expect(() => loadConfig({ ...testEnv(), PORT: '0' })).toThrow(/PORT must be between/);
    expect(() => loadConfig({ ...testEnv(), KEEPER_INTERVAL_MS: '10' })).toThrow(
      /KEEPER_INTERVAL_MS must be between/,
    );
    expect(() => loadConfig({ ...testEnv(), KEEPER_BATCH_SIZE: 'many' })).toThrow(
      /KEEPER_BATCH_SIZE must be an integer/,
    );
  });

  it('rejects a flag that is not a boolean', () => {
    const env = {
      ...testEnv(),
      KEEPER_SECRET_KEY: Keypair.random().secret(),
      KEEPER_ENABLED: 'maybe',
    };

    expect(() => loadConfig(env)).toThrow(/KEEPER_ENABLED must be a boolean/);
  });
});
