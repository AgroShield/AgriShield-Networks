/**
 * Loading one request into renderable state.
 *
 * The console needs the same four states in seven places — not asked for yet,
 * asking, answered, failed — so they are a type rather than seven pairs of
 * booleans. A `null` loader means the request cannot be made yet (nothing has
 * been searched for, nothing is selected), which is distinct from "loading" and
 * from "failed", and is what stops an empty search bar from querying the API.
 *
 * There is no caching layer: every `reload` is a real request. That is the point
 * of talking to a read-through API — the answer is only ever as stale as the
 * last call — and the busy paths here are a button press, not a render loop.
 */

import { useCallback, useEffect, useState } from 'react';

export type Async<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: unknown };

export interface AsyncResult<T> {
  readonly state: Async<T>;
  /** Runs the request again, for a refresh button or after a mutation. */
  readonly reload: () => void;
}

/**
 * Runs `load` whenever `deps` change.
 *
 * `load` is intentionally not a dependency: the caller writes a closure over the
 * values it cares about and names those in `deps`, which is what actually says
 * when the request has new inputs. An answer that arrives after the inputs have
 * changed again is discarded rather than applied, so a slow response for an old
 * policy cannot overwrite a fast one for the policy now selected.
 */
export function useAsync<T>(
  load: (() => Promise<T>) | null,
  deps: readonly unknown[],
): AsyncResult<T> {
  const [state, setState] = useState<Async<T>>(
    load === null ? { status: 'idle' } : { status: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (load === null) {
      setState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [...deps, attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
