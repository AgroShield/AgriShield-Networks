/**
 * Schemas and helpers shared by the route modules.
 *
 * Request schemas are declared for runtime validation; responses are shaped by
 * the typed serializers in `serializers.ts` instead. Declaring both would mean
 * describing every response field twice, and the serializers are already the
 * single place a response field can come from.
 *
 * A schema can only check the *shape* of a value, which is not the same as
 * checking that the chain will accept it. Everything a request contributes to a
 * contract call is therefore also checked against the constraint the contract
 * itself imposes — the width of a `u64`, the character repertoire of a `Symbol`,
 * the checksum of a strkey. Skipping that does not fail loudly: the argument
 * encoder throws before any simulation happens, and a throw from the encoder is
 * not a contract rejection, so the request is reported as the RPC node being
 * unreachable. A caller asking for a policy id that cannot exist deserves a 400,
 * not a 503 that sends someone to check the node's health.
 */

import { StrKey } from '@stellar/stellar-sdk';

import { badRequest } from '../errors.js';

/** The largest id the registry can hold, because a policy id is a `u64`. */
export const MAX_POLICY_ID = 18_446_744_073_709_551_615n;

/** A policy id is a `u64`, so at most twenty decimal digits. */
export const POLICY_ID_PARAMS = {
  type: 'object',
  required: ['policyId'],
  properties: {
    policyId: { type: 'string', pattern: '^[0-9]{1,20}$' },
  },
  additionalProperties: false,
} as const;

/** A Stellar strkey: `G...` for an account, `C...` for a contract. */
const STRKEY_PATTERN = '^[GC][A-Z2-7]{55}$';

/**
 * A Soroban symbol: at most 32 bytes drawn from `[a-zA-Z0-9_]`.
 *
 * Restricting the repertoire rather than the character count also settles the
 * byte length, because every admitted character is a single byte.
 */
const SYMBOL_PATTERN = '^[a-zA-Z0-9_]{1,32}$';

export const POLICY_LIST_QUERY = {
  type: 'object',
  properties: {
    farmer: { type: 'string', pattern: STRKEY_PATTERN },
    region: { type: 'string', pattern: SYMBOL_PATTERN },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
} as const;

/** How many policies a list response hydrates when no limit is asked for. */
export const DEFAULT_LIST_LIMIT = 20;

/**
 * Parses a validated `policyId` path parameter.
 *
 * Twenty digits is enough to name a number larger than a `u64` can hold, so the
 * range is checked after the shape.
 */
export function policyIdFrom(value: string): bigint {
  let id: bigint;
  try {
    id = BigInt(value);
  } catch {
    // The schema already constrains the shape, so this is belt and braces.
    throw badRequest('invalid_policy_id', 'policyId must be a decimal policy id');
  }
  if (id > MAX_POLICY_ID) {
    throw badRequest(
      'invalid_policy_id',
      `policyId must fit a u64, so at most ${MAX_POLICY_ID.toString()}`,
    );
  }
  return id;
}

/**
 * Verifies a farmer address against its checksum.
 *
 * The schema for a `farmer` query only recognises the strkey alphabet, so a
 * mistyped-but-plausible address — the common case, since these are pasted by
 * hand — reaches the encoder and is rejected there as an unusable address.
 */
export function farmerAddress(value: string): string {
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw badRequest('invalid_farmer', 'farmer must be a Stellar account id (a G... strkey)');
  }
  return value;
}
