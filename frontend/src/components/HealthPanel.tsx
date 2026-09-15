import type { ReactElement } from 'react';

import { describeFailure } from '../api/client';
import type { Health } from '../api/types';
import type { Async } from '../useAsync';
import { Notice } from './Notice';
import { StatusChip, toneFor } from './StatusChip';

export interface HealthPanelProps {
  readonly state: Async<Health>;
  readonly onRefresh: () => void;
}

/**
 * What the API says about itself.
 *
 * Worth a panel rather than a discreet dot, because this endpoint answers 503
 * for a reason the console has to surface: the process can be reachable and
 * still be pointed at different contracts than the engine settles against, in
 * which case every policy it reports would be confidently wrong. The `reason`
 * field is the part that says which of those it is.
 */
export function HealthPanel({ state, onRefresh }: HealthPanelProps): ReactElement {
  return (
    <section className="panel panel--inline health" aria-label="API health">
      <header className="panel__header">
        <h2 className="panel__title">API</h2>
        <button type="button" className="button button--quiet" onClick={onRefresh}>
          Refresh
        </button>
      </header>
      {body()}
    </section>
  );

  function body(): ReactElement {
    if (state.status === 'idle' || state.status === 'loading') {
      return <p className="muted">Checking the API…</p>;
    }
    if (state.status === 'error') {
      return (
        <Notice
          kind="error"
          title="The API did not answer"
          detail={describeFailure(state.error)}
        />
      );
    }

    const health = state.data;
    return (
      <div className="health__body">
        <div className="row">
          <StatusChip label={health.status} tone={toneFor(health.status)} />
          <span className="muted">{health.network}</span>
          {health.ledger === null ? null : <span className="muted">ledger {health.ledger}</span>}
        </div>
        {health.reason === null ? null : <p className="muted">{health.reason}</p>}
        <p className="muted">
          {health.keeper.enabled
            ? 'This deployment holds a keeper key, so settlements can be submitted.'
            : 'Read-only deployment: no keeper key is configured, so settlements cannot be submitted.'}
        </p>
      </div>
    );
  }
}
