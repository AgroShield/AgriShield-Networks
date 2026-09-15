/**
 * Shape checks for values arriving from the API.
 *
 * The API is a separate process, so its responses are a boundary and a
 * TypeScript interface is a claim, not a check. These helpers are the check: the
 * decoders in `types.ts` build every domain value through them, so a field that
 * was renamed, or an integer that stopped arriving as a string, fails loudly
 * with the field named instead of rendering as `undefined` in the UI.
 *
 * The checks are deliberately shallow — they verify the shape the UI depends on,
 * not a schema. Anything deeper is the backend's decoders' job, and duplicating
 * that here would give two places to keep in step.
 */

/** Thrown when a response does not have the shape this build expects. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapeError';
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return `${typeof value} ${JSON.stringify(value)}`;
}

export function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ShapeError(`${what}: expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

/** An object nested under a named field, or `null` when the API sent null. */
export function nested(
  source: Record<string, unknown>,
  field: string,
  what: string,
): Record<string, unknown> | null {
  const value = source[field];
  if (value === null) return null;
  return record(value, `${what}.${field}`);
}

export function text(source: Record<string, unknown>, field: string, what: string): string {
  const value = source[field];
  if (typeof value !== 'string') {
    throw new ShapeError(`${what}.${field}: expected a string, got ${describe(value)}`);
  }
  return value;
}

/** A string that the API may send as `null`, as it does inside a sweep entry. */
export function maybeText(
  source: Record<string, unknown>,
  field: string,
  what: string,
): string | null {
  const value = source[field];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ShapeError(`${what}.${field}: expected a string or null, got ${describe(value)}`);
  }
  return value;
}

/**
 * An on-chain integer, which this API always sends as a decimal string.
 *
 * It is a string because a `u64` or `i128` does not fit a JavaScript number, and
 * the type is asserted here rather than coerced: `Number('')` is `0`, so a
 * coercion would turn a missing field into a plausible-looking amount.
 */
export function integer(source: Record<string, unknown>, field: string, what: string): string {
  return integerValue(source[field], `${what}.${field}`);
}

/**
 * A bare decimal integer string, for a value that is not inside an object — an
 * element of `policyIds`, for instance.
 */
export function integerValue(value: unknown, what: string): string {
  if (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)) {
    throw new ShapeError(`${what}: expected a decimal integer string, got ${describe(value)}`);
  }
  return value;
}

/** A small count the API sends as a JSON number, such as a total or a ledger. */
export function count(source: Record<string, unknown>, field: string, what: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ShapeError(`${what}.${field}: expected an integer, got ${describe(value)}`);
  }
  return value;
}

/** A nullable count, as `ledger` is on a health report from an unreachable node. */
export function maybeCount(
  source: Record<string, unknown>,
  field: string,
  what: string,
): number | null {
  const value = source[field];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ShapeError(`${what}.${field}: expected an integer or null, got ${describe(value)}`);
  }
  return value;
}

export function flag(source: Record<string, unknown>, field: string, what: string): boolean {
  const value = source[field];
  if (typeof value !== 'boolean') {
    throw new ShapeError(`${what}.${field}: expected a boolean, got ${describe(value)}`);
  }
  return value;
}

export function list(source: Record<string, unknown>, field: string, what: string): unknown[] {
  const value = source[field];
  if (!Array.isArray(value)) {
    throw new ShapeError(`${what}.${field}: expected a list, got ${describe(value)}`);
  }
  return value;
}

/** One of a fixed set of names, so a status the UI cannot render is an error. */
export function oneOf<T extends string>(
  source: Record<string, unknown>,
  field: string,
  what: string,
  allowed: readonly T[],
): T {
  const value = text(source, field, what);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ShapeError(
      `${what}.${field}: expected one of ${allowed.join(', ')} but got ${JSON.stringify(value)}`,
    );
  }
  return match;
}
