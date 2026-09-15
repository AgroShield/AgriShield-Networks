/**
 * Schemas and helpers shared by the route modules.
 *
 * Request schemas are declared for runtime validation; responses are shaped by
 * the typed serializers in `serializers.ts` instead. Declaring both would mean
 * describing every response field twice, and the serializers are already the
 * single place a response field can come from.
 */

import { badRequest } from '../errors.js';

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

export const POLICY_LIST_QUERY = {
  type: 'object',
  properties: {
    farmer: { type: 'string', pattern: STRKEY_PATTERN },
    region: { type: 'string', minLength: 1, maxLength: 32 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
} as const;

/** How many policies a list response hydrates when no limit is asked for. */
export const DEFAULT_LIST_LIMIT = 20;

/** Parses a validated `policyId` path parameter. */
export function policyIdFrom(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    // The schema already constrains the shape, so this is belt and braces.
    throw badRequest('invalid_policy_id', 'policyId must be a decimal policy id');
  }
}
