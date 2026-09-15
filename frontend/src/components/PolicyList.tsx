import type { ReactElement } from 'react';

import { describeFailure } from '../api/client';
import type { PolicyList as PolicyListData } from '../api/types';
import { formatTokenAmount, formatWindow, pluralise, stroopsLabel } from '../format';
import type { Async } from '../useAsync';
import { Notice } from './Notice';
import { StatusChip, toneFor } from './StatusChip';

export interface PolicyListProps {
  readonly state: Async<PolicyListData>;
  readonly selectedId: string | null;
  readonly onSelect: (policyId: string) => void;
  readonly onRefresh: () => void;
  /** Asks for a wider slice of the same filter. */
  readonly onShowMore: () => void;
  readonly canShowMore: boolean;
}

/** How many matched policies are still unhydrated. */
function remaining(data: PolicyListData): number {
  return Math.max(0, data.total - data.policies.length);
}

/**
 * The policies one search matched.
 *
 * The API answers with every id it matched plus the newest few hydrated, so the
 * counts are stated rather than implied: a client that showed only the hydrated
 * ones would quietly report a smaller book than exists.
 */
export function PolicyList({
  state,
  selectedId,
  onSelect,
  onRefresh,
  onShowMore,
  canShowMore,
}: PolicyListProps): ReactElement {
  return (
    <section className="list" aria-label="Matched policies">
      <header className="list__header">
        <span className="muted">{summary()}</span>
        <button
          type="button"
          className="button button--quiet"
          onClick={onRefresh}
          disabled={state.status === 'idle'}
        >
          Refresh
        </button>
      </header>
      {body()}
      {canShowMore && state.status === 'ready' ? (
        <button type="button" className="button button--wide" onClick={onShowMore}>
          Hydrate {remaining(state.data)} more
        </button>
      ) : null}
    </section>
  );

  function summary(): string {
    if (state.status === 'idle') return 'No search yet';
    if (state.status === 'loading') return 'Reading policies…';
    if (state.status === 'error') return 'Could not read policies';

    const { total, policies } = state.data;
    if (total === 0) return 'Nothing matched';
    return `Showing the newest ${policies.length} of ${total} ${pluralise(total, 'policy', 'policies')}`;
  }

  function body(): ReactElement | null {
    if (state.status === 'idle') {
      return (
        <Notice
          kind="empty"
          title="Search for a farmer or a region"
          detail="Policies are looked up by the farmer holding them, or by the region they cover."
        />
      );
    }

    if (state.status === 'loading') {
      return <p className="muted">Reading policies…</p>;
    }

    if (state.status === 'error') {
      return (
        <Notice
          kind="error"
          title="Could not read the policy list"
          detail={describeFailure(state.error)}
        />
      );
    }

    const { policies } = state.data;
    if (policies.length === 0) {
      return (
        <Notice
          kind="empty"
          title="No policies matched"
          detail="This filter names no policies."
        />
      );
    }

    return (
      <ul className="list__items">
        {policies.map((policy) => (
          <li key={policy.id}>
            <button
              type="button"
              className={`policy-row${selectedId === policy.id ? ' policy-row--selected' : ''}`}
              aria-current={selectedId === policy.id}
              onClick={() => {
                onSelect(policy.id);
              }}
            >
              <span className="policy-row__head">
                <span className="policy-row__id">#{policy.id}</span>
                <StatusChip label={policy.status} tone={toneFor(policy.status)} />
              </span>
              <span className="policy-row__meta">
                {policy.regionId} · {policy.cropType}
              </span>
              <span className="policy-row__window">
                {formatWindow(policy.coverageStart, policy.coverageEnd)}
              </span>
              <span className="policy-row__amount" title={stroopsLabel(policy.payoutAmount)}>
                {formatTokenAmount(policy.payoutAmount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
}
