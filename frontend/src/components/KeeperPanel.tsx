import type { ReactElement } from 'react';

import { describeFailure } from '../api/client';
import type { KeeperStatus, SweepReport } from '../api/types';
import { formatClock, shorten } from '../format';
import type { Async } from '../useAsync';
import { Field, FieldGrid } from './Field';
import { Notice } from './Notice';
import { StatusChip, toneFor } from './StatusChip';

export interface KeeperPanelProps {
  readonly state: Async<KeeperStatus>;
  readonly onRefresh: () => void;
}

/**
 * What the settlement keeper has been doing.
 *
 * The totals are cumulative for the process, so they answer "has this sweeper
 * ever settled anything" while the last sweep answers "is it working right
 * now" — two different questions that a single count would blur.
 */
export function KeeperPanel({ state, onRefresh }: KeeperPanelProps): ReactElement {
  return (
    <section className="panel keeper" aria-label="Settlement keeper">
      <header className="panel__header">
        <h2 className="panel__title">Settlement keeper</h2>
        <button type="button" className="button button--quiet" onClick={onRefresh}>
          Refresh
        </button>
      </header>
      {body()}
    </section>
  );

  function body(): ReactElement {
    if (state.status === 'idle' || state.status === 'loading') {
      return <p className="muted">Reading the keeper…</p>;
    }
    if (state.status === 'error') {
      return (
        <Notice
          kind="error"
          title="Could not read the keeper"
          detail={describeFailure(state.error)}
        />
      );
    }

    const keeper = state.data;
    if (!keeper.enabled) {
      return (
        <Notice
          kind="info"
          title="This deployment is read-only"
          detail="No keeper key is configured, so nothing is swept and settlements cannot be submitted."
        />
      );
    }

    return (
      <>
        <div className="row">
          <StatusChip
            label={keeper.running ? 'sweeping' : 'stopped'}
            tone={keeper.running ? 'good' : 'warn'}
          />
          <span className="muted">next sweep starts at #{keeper.cursor}</span>
        </div>
        <FieldGrid>
          <Field label="Policies examined">{keeper.totals.swept}</Field>
          <Field label="Settled">{keeper.totals.settled}</Field>
          <Field label="Expired">{keeper.totals.expired}</Field>
          <Field label="Failed">{keeper.totals.failed}</Field>
        </FieldGrid>
        {keeper.lastSweep === null ? (
          <p className="muted">No sweep has finished yet.</p>
        ) : (
          sweep(keeper.lastSweep)
        )}
      </>
    );
  }
}

function sweep(report: SweepReport): ReactElement {
  return (
    <section className="keeper__sweep" aria-label="Last sweep">
      <h4 className="detail__section-title">Last sweep</h4>
      <p className="muted">
        {formatClock(report.startedAt)} · examined {report.considered} · settled {report.settled} ·
        expired {report.expired} · failed {report.failed}
      </p>
      {report.entries.length === 0 ? (
        <p className="muted">It examined no policies.</p>
      ) : (
        <ul className="keeper__entries">
          {report.entries.map((entry, index) => (
            // A policy can appear once per sweep, so the id alone is not unique
            // across a report that repeats one.
            <li key={`${entry.policyId}:${index}`} className="keeper__entry">
              <span className="policy-row__id">#{entry.policyId}</span>
              <StatusChip label={entry.action} tone={toneFor(entry.action)} />
              {entry.reason === null ? null : <span className="muted">{entry.reason}</span>}
              {entry.transactionHash === null ? null : (
                <span className="muted mono" title={entry.transactionHash}>
                  {shorten(entry.transactionHash, 8, 6)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
