/**
 * Application errors that map onto HTTP responses.
 *
 * A route either throws one of these — in which case its status code and its
 * stable, machine-readable `code` are part of the API contract — or throws
 * something else, which the server reports as a 500 without echoing internals.
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

/** 404 — the thing the request names does not exist on chain. */
export function notFound(code: string, message: string, details?: unknown): AppError {
  return new AppError(404, code, message, details);
}

/**
 * 409 — the request was well formed but the chain is in a state that makes it
 * impossible, such as settling a policy that has already left the book.
 */
export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

/** 502 — an upstream contract call was rejected. */
export function badGateway(code: string, message: string, details?: unknown): AppError {
  return new AppError(502, code, message, details);
}

/** 503 — a dependency is unavailable, so the request could not be attempted. */
export function unavailable(code: string, message: string, details?: unknown): AppError {
  return new AppError(503, code, message, details);
}
