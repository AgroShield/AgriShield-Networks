/**
 * A scripted `fetch`.
 *
 * The client's own tests run in the node environment, where `Response` is the
 * real one, so these produce genuine responses rather than objects shaped like
 * them: the client reads `.ok`, `.status` and `.text()`, and asserting against a
 * hand-rolled stand-in would only prove it reads what the stand-in provides.
 */

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
}

/** A fetch that answers from `handler`, recording what it was asked for. */
export function respondWith(
  handler: (url: string, init: RequestInit | undefined) => Response,
  requests: RecordedRequest[] = [],
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, method: init?.method ?? 'GET' });
    return Promise.resolve(handler(url, init));
  };
}

/** A JSON response, as the API answers with. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A response with no body at all. */
export function empty(status: number): Response {
  return new Response('', { status });
}

/** A response whose body is not JSON, as a proxy's error page would be. */
export function html(status: number): Response {
  return new Response('<html><body>gateway error</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}
