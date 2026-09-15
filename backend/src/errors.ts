/**
 * Application errors that map onto HTTP responses.
 *
 * A route either throws one of these — in which case its status code and its
 * stable, machine-readable `code` are part of the API contract — or throws
 * something else, which the server reports as a 500 without echoing internals.
 *
 * Only the statuses a route decides itself have a helper. A 404 or a 409 for a
 * policy that does not exist, or that has already left the book, is not a
 * decision a route makes: it comes from the contract's own error code via the
 * table in `contracts/clients.ts`, and inventing a second way to produce it here
 * would let the two disagree.
 */

/** HTTP status codes the API uses deliberately. */
export type ErrorStatus = 400 | 404 | 409 | 502 | 503;

export class AppError extends Error {
  readonly statusCode: ErrorStatus;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: ErrorStatus, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** A one-line description of an unknown thrown value, for logs and diagnostics. */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 400 — the request itself is wrong and retrying it unchanged will not help. */
export function badRequest(code: string, message: string, details?: unknown): AppError {
  return new AppError(400, code, message, details);
}

/** 502 — an upstream contract call was rejected. */
export function badGateway(code: string, message: string, details?: unknown): AppError {
  return new AppError(502, code, message, details);
}

/** 503 — a dependency is unavailable, so the request could not be attempted. */
export function unavailable(code: string, message: string, details?: unknown): AppError {
  return new AppError(503, code, message, details);
}
