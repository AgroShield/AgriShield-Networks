import { useState, type ReactElement } from 'react';

import { describeFailure, type ApiClient } from '../api/client';
import type { Evaluation, Policy, SubmittedSettlement } from '../api/types';
import {
  formatTimestamp,
  formatTokenAmount,
  formatWindow,
  isUnset,
  shorten,
  stroopsLabel,
} from '../format';
import type { Async } from '../useAsync';
import { Field, FieldGrid } from './Field';
import { Notice } from './Notice';
import { StatusChip, toneFor } from './StatusChip';

export interface PolicyDetailProps {
  readonly client: ApiClient;
  readonly policyState: Async<Policy>;
  readonly previewState: Async<Evaluation>;
  /** `null` while health is unknown, `false` on a read-only deployment. */
  readonly canSubmit: boolean | null;
  readonly onRefreshPolicy: () => void;
  readonly onRefreshPreview: () => void;
  /** Refreshes everything a settlement could have changed. */
  readonly onSettled: () => void;
}

/**
 * One policy, what settlement would do with it, and the button that does it.
 *
 * The caller keys this component on the policy id, so the outcome of a
 * submission belongs to the policy it was made for and cannot be shown against
 * the next one selected.
 */
export function PolicyDetail({
  client,
  policyState,
  previewState,
  canSubmit,
  onRefreshPolicy,
  onRefreshPreview,
  onSettled,
}: PolicyDetailProps): ReactElement {
  const [submitting, setSubmitting] = useState(false);
  const [settled, setSettled] = useState<SubmittedSettlement | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  if (policyState.status === 'idle' || policyState.status === 'loading') {
    return <p className="muted">Reading the policy…</p>;
  }
  if (policyState.status === 'error') {
    return (
      <Notice
        kind="error"
        title="Could not read the policy"
        detail={describeFailure(policyState.error)}
      />
    );
  }

  const policy = policyState.data;

  return (
    <div className="detail">
      <header className="detail__header">
        <div className="row">
          <h3 className="detail__id">Policy #{policy.id}</h3>
          <StatusChip label={policy.status} tone={toneFor(policy.status)} />
        </div>
        <button type="button" className="button button--quiet" onClick={onRefreshPolicy}>
          Refresh
        </button>
      </header>

      <FieldGrid>
        <Field label="Region" mono>
          {policy.regionId}
        </Field>
        <Field label="Crop" mono>
          {policy.cropType}
        </Field>
        <Field label="Farmer" title={policy.farmer} mono>
          {shorten(policy.farmer, 10, 6)}
        </Field>
        <Field label="Plot hash" title={policy.plotHash} mono>
          {shorten(policy.plotHash, 12, 8)}
        </Field>
        <Field label="Cover" title={`${policy.coverageStart} → ${policy.coverageEnd}`}>
          {formatWindow(policy.coverageStart, policy.coverageEnd)}
        </Field>
        {/* An index value, not an amount: it is compared against the oracle's
            reading, so formatting it as a token would invent a unit. */}
        <Field label="Pays at index ≤">{policy.triggerThreshold}</Field>
        <Field label="Payout" title={stroopsLabel(policy.payoutAmount)}>
          {formatTokenAmount(policy.payoutAmount)}
        </Field>
        <Field label="Premium" title={stroopsLabel(policy.premium)}>
          {formatTokenAmount(policy.premium)}
        </Field>
        <Field label="Created">{formatTimestamp(policy.createdAt)}</Field>
        <Field label="Settled">
          {isUnset(policy.settledAt) ? 'not yet' : formatTimestamp(policy.settledAt)}
        </Field>
      </FieldGrid>

      <section className="detail__section" aria-label="Settlement preview">
        <header className="detail__section-header">
          <h4 className="detail__section-title">Settlement preview</h4>
          <button type="button" className="button button--quiet" onClick={onRefreshPreview}>
            Re-check
          </button>
        </header>
        {preview()}
      </section>

      <section className="detail__section" aria-label="Submit settlement">
        <header className="detail__section-header">
          <h4 className="detail__section-title">Settle</h4>
        </header>
        <p className="muted">
          Submission calls the engine&rsquo;s own settlement, which re-derives the decision on
          chain. It cannot be used to pay a policy the index has not triggered.
        </p>
        {canSubmit === false ? (
          <Notice
            kind="info"
            title="Read-only deployment"
            detail="No keeper key is configured, so this console cannot submit a settlement."
          />
        ) : null}
        <button
          type="button"
          className="button"
          disabled={submitting || canSubmit === false}
          onClick={() => {
            void submit(policy.id);
          }}
        >
          {submitting ? 'Submitting…' : 'Submit settlement'}
        </button>
        {failure === null ? null : (
          <Notice
            kind="error"
            title="Settlement was refused"
            detail={describeFailure(failure)}
          />
        )}
        {settled === null ? null : (
          <Notice
            kind="info"
            title={`Settlement ${settled.outcome.status}`}
            detail={settledDetail(settled)}
          />
        )}
      </section>
    </div>
  );

  function preview(): ReactElement {
    if (previewState.status === 'idle' || previewState.status === 'loading') {
      return <p className="muted">Asking the engine…</p>;
    }
    if (previewState.status === 'error') {
      return (
        <Notice
          kind="error"
          title="Could not preview settlement"
          detail={describeFailure(previewState.error)}
        />
      );
    }

    const evaluation = previewState.data;
    return (
      <>
        <div className="row">
          <StatusChip label={evaluation.status} tone={toneFor(evaluation.status)} />
          <span className="muted">{explain(evaluation)}</span>
        </div>
        <FieldGrid>
          <Field label="Index reading">
            {isUnset(evaluation.readingTimestamp)
              ? 'none in the window'
              : `${evaluation.indexValue} at ${formatTimestamp(evaluation.readingTimestamp)}`}
          </Field>
          <Field label="Would pay" title={stroopsLabel(evaluation.payoutAmount)}>
            {formatTokenAmount(evaluation.payoutAmount)}
          </Field>
        </FieldGrid>
      </>
    );
  }

  async function submit(policyId: string): Promise<void> {
    setSubmitting(true);
    setFailure(null);
    setSettled(null);
    try {
      const result = await client.settle(policyId);
      setSettled(result);
      // A settlement changes the policy, its preview and the keeper's totals, so
      // the answer the API already returned is not used to guess at any of them.
      onSettled();
    } catch (cause) {
      setFailure(cause);
    } finally {
      setSubmitting(false);
    }
  }
}

/** What a preview status means, in terms of the policy rather than the enum. */
function explain(evaluation: Evaluation): string {
  switch (evaluation.status) {
    case 'Paid':
      return 'The index breached the threshold inside the cover window.';
    case 'Expired':
      return 'The window has closed without a qualifying reading.';
    case 'Pending':
      // Deliberately not "cover is open": at the closing instant the window has
      // ended but the registry's expiry gate has not opened yet, and both report
      // `Pending`. What is true in both cases is that nothing is due.
      return 'No payout is due yet.';
  }
}

function settledDetail(settled: SubmittedSettlement): string {
  const paid =
    settled.outcome.paidAmount === '0'
      ? 'Nothing was paid.'
      : `Paid ${formatTokenAmount(settled.outcome.paidAmount)}.`;
  return `${paid} Transaction ${settled.transactionHash}, in ledger ${settled.ledger}.`;
}
