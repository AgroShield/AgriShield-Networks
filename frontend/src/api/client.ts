/**
 * The typed client for the AgriShield backend.
 *
 * Every call the console makes goes through here, so no component builds a URL
 * or reads a response field by hand. Two things are deliberately centralised:
 *
 * * **Failure translation.** The API answers every failure it decides itself
 *   with `{ error: { code, message } }`, so one parser turns a 400, a 409 and a
 *   502 into the same {@link ApiError}. A request that never reached the API is
 *   reported as `status: 0` rather than being dressed up as a server response,
 *   because "the API said no" and "there is no API there" need different fixes.
 * * **Verification.** Responses are decoded by the functions in `types.ts`
 *   rather than asserted, so a field that moved fails with its name attached.
 */

import { ShapeError } from './shape';
import {
  decodeEvaluation,
  decodeHealth,
  decodeKeeperStatus,
  decodePolicy,
  decodePolicyList,
  decodeSubmittedSettlement,
  looksLikeHealth,
  type Evaluation,
  type Health,
  type KeeperStatus,
  type Policy,
  type PolicyList,
  type SubmittedSettlement,
} from './types';

export { ShapeError };

/** A failure the API reported, or a request that never reached it. */
export class ApiError extends Error {
  /** HTTP status, or `0` when the request never got an answer. */
  readonly status: number;
  /** The API's stable, machine-readable code, such as `policy_not_found`. */
  readonly code: string;
  /** Whatever supporting context the API attached, when it attached any. */
  readonly details: unknown;

  constructor(init: { status: number; code: string; message: string; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  /** Nothing answered, which usually means the API is not running. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

/**
 * The exactly-one-of rule the list endpoint enforces.
 *
 * The backend answers a 400 when both `farmer` and `region` are given, and scans
 * its whole book when neither is. A union makes both mistakes unrepresentable
 * here rather than leaving the caller to find out from the API.
 */
export type PolicyQuery =
  | { readonly farmer: string; readonly region?: undefined; readonly limit?: number }
  | { readonly region: string; readonly farmer?: undefined; readonly limit?: number };

export interface ApiClient {
  readonly baseUrl: string;
  health(): Promise<Health>;
  listPolicies(query: PolicyQuery): Promise<PolicyList>;
  getPolicy(policyId: string): Promise<Policy>;
  settlementPreview(policyId: string): Promise<Evaluation>;
  settle(policyId: string): Promise<SubmittedSettlement>;
  keeperStatus(): Promise<KeeperStatus>;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Injected so a test can drive the client with no server and no network. */
  readonly fetch?: typeof fetch;
}

/** A response the API answered with, parsed as far as JSON. */
interface Answer {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

/**
 * One line describing a failure, for display.
 *
 * An API error carries a code worth showing — it is the difference between "the
 * policy is already settled" and "something went wrong" — so it is included. A
 * decode failure has nothing but its message, which already names the field.
 */
export function describeFailure(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.isOffline ? cause.message : `${cause.code}: ${cause.message}`;
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  const send =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      globalThis.fetch(input, init));

  async function readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A body that is not JSON is reported by the caller, which knows whether
      // it needed one.
      return undefined;
    }
  }

  async function call(path: string, init?: RequestInit): Promise<Answer> {
    let response: Response;
    try {
      response = await send(`${baseUrl}${path}`, init);
    } catch (cause) {
      // `fetch` rejects only when nothing was answered. There is no status code
      // and no error code to report, so this does not pretend to be one.
      throw new ApiError({
        status: 0,
        code: 'network_unreachable',
        message: `the API could not be reached at ${baseUrl}`,
        details: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const body = await readBody(response);
    return { status: response.status, ok: response.ok, body };
  }

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const answer = await call(path, init);
    if (!answer.ok) throw errorFrom(answer.status, answer.body, path);
    if (answer.body === undefined) {
      throw new ApiError({
        status: answer.status,
        code: 'empty_response',
        message: `the API answered ${answer.status} for ${path} with no body`,
      });
    }
    return answer.body;
  }

  return {
    baseUrl,

    async health(): Promise<Health> {
      const answer = await call('/health');
      // `/health` uses 503 for both "the node is unreachable" and "this process
      // is wired to different contracts than the engine", and in both cases the
      // body is a full report rather than the error envelope. Letting the status
      // alone decide would throw away the explanation that is the whole point of
      // the endpoint, so the body is what is checked first.
      if (looksLikeHealth(answer.body)) return decodeHealth(answer.body);
      if (!answer.ok) throw errorFrom(answer.status, answer.body, '/health');
      throw new ShapeError('health report: the API answered 200 without a health report');
    },

    async listPolicies(query: PolicyQuery): Promise<PolicyList> {
      const path = `/policies${queryString({
        farmer: query.farmer,
        region: query.region,
        limit: query.limit,
      })}`;
      return decodePolicyList(await request(path));
    },

    async getPolicy(policyId: string): Promise<Policy> {
      return decodePolicy(await request(`/policies/${encodeURIComponent(policyId)}`));
    },

    async settlementPreview(policyId: string): Promise<Evaluation> {
      return decodeEvaluation(
        await request(`/policies/${encodeURIComponent(policyId)}/settlement`),
      );
    },

    async settle(policyId: string): Promise<SubmittedSettlement> {
      return decodeSubmittedSettlement(
        await request(`/settlements/${encodeURIComponent(policyId)}`, { method: 'POST' }),
      );
    },

    async keeperStatus(): Promise<KeeperStatus> {
      return decodeKeeperStatus(await request('/settlements/keeper'));
    },
  };
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/**
 * Reads the API's error envelope.
 *
 * A response without one did not come from the API's own error handling — a
 * reverse proxy or the platform answered instead — so it is reported as such
 * rather than being given a code the API never sent.
 */
function errorFrom(status: number, body: unknown, path: string): ApiError {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const envelope = (body as Record<string, unknown>)['error'];
    if (typeof envelope === 'object' && envelope !== null && !Array.isArray(envelope)) {
      const fields = envelope as Record<string, unknown>;
      return new ApiError({
        status,
        code: typeof fields['code'] === 'string' ? fields['code'] : 'unknown_error',
        message:
          typeof fields['message'] === 'string'
            ? fields['message']
            : `the API answered ${status}`,
        details: fields['details'],
      });
    }
  }
  return new ApiError({
    status,
    code: 'unexpected_response',
    message: `the API answered ${status} for ${path} without an error body`,
  });
}
