import React, { useState } from 'react';

import { useWallet } from '../wallet/WalletContext.js';
import { Field, FieldGrid } from './Field.js';
import { StatusChip } from './StatusChip.js';

interface RegionalReading {
  region: string;
  latestValue: number;
  updatedAt: string;
  status: 'finalized' | 'pending';
}

interface PendingSubmission {
  id: string;
  region: string;
  value: number;
  approvals: number;
  required: number;
  submittedAt: string;
}

export function OraclePanel(): React.JSX.Element {
  const { isConnected, account, signTransaction } = useWallet();

  const [readings] = useState<RegionalReading[]>([
    { region: 'US-MW', latestValue: 620, updatedAt: '12 minutes ago', status: 'finalized' },
    { region: 'KE-RFT', latestValue: 410, updatedAt: '35 minutes ago', status: 'finalized' },
    { region: 'BR-CEN', latestValue: 840, updatedAt: '1 hour ago', status: 'finalized' },
    { region: 'IN-PUN', latestValue: 510, updatedAt: '2 hours ago', status: 'finalized' },
  ]);

  const [pendingList, setPendingList] = useState<PendingSubmission[]>([
    {
      id: 'sub-101',
      region: 'US-MW',
      value: 615,
      approvals: 1,
      required: 2,
      submittedAt: '5 minutes ago',
    },
    {
      id: 'sub-102',
      region: 'KE-RFT',
      value: 395,
      approvals: 1,
      required: 2,
      submittedAt: '8 minutes ago',
    },
  ]);

  const [newRegion, setNewRegion] = useState('US-MW');
  const [newValue, setNewValue] = useState(630);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const handleCoSign = async (pendingId: string) => {
    setIsSubmitting(true);
    setActionNotice(null);
    try {
      if (isConnected) {
        await signTransaction(`mock-xdr-cosign-${pendingId}`);
      }
      setPendingList((prev) =>
        prev
          .map((item) => (item.id === pendingId ? { ...item, approvals: item.approvals + 1 } : item))
          .filter((item) => item.approvals < item.required),
      );
      setActionNotice(`Reading co-signed and threshold met! Observation finalized.`);
      setTimeout(() => setActionNotice(null), 4000);
    } catch {
      // Ignored
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setActionNotice(null);
    try {
      if (isConnected) {
        await signTransaction(`mock-xdr-oracle-submit-${newRegion}-${newValue}`);
      }
      setPendingList((prev) => [
        ...prev,
        {
          id: `sub-${Date.now()}`,
          region: newRegion,
          value: newValue,
          approvals: 1,
          required: 2,
          submittedAt: 'Just now',
        },
      ]);
      setActionNotice(`New reading observation submitted for ${newRegion}. Awaiting threshold co-signature.`);
      setTimeout(() => setActionNotice(null), 4000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel" aria-label="Oracle Signer Portal">
      <header className="panel__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="panel__title">🛰️ Weather Oracle & Threshold Signers</h2>
        <StatusChip label="Threshold: 2 of 3 Signers" tone="neutral" />
      </header>

      <p className="muted" style={{ margin: '0 0 1rem 0' }}>
        Parametric settlements trigger automatically when oracle nodes reach consensus on environmental
        index observations.
      </p>

      {actionNotice && (
        <div style={{ padding: '0.5rem 0.75rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {actionNotice}
        </div>
      )}

      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
        Latest Finalized Weather Indices
      </h4>
      <FieldGrid>
        {readings.map((r) => (
          <Field key={r.region} label={`${r.region} Index`}>
            <strong>{r.latestValue}</strong> <span className="muted">({r.updatedAt})</span>
          </Field>
        ))}
      </FieldGrid>

      <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e5e7eb' }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
          Pending Observations Awaiting Co-signature
        </h4>
        {pendingList.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.875rem' }}>No pending observations awaiting approval.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pendingList.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                }}
              >
                <div>
                  <strong>{p.region}</strong>: Observed Index <strong>{p.value}</strong>
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>
                    ({p.approvals}/{p.required} signatures · {p.submittedAt})
                  </span>
                </div>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() => void handleCoSign(p.id)}
                  disabled={isSubmitting}
                >
                  ✍️ Co-sign Reading
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e5e7eb' }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
          Submit New Station Observation
        </h4>
        <form onSubmit={handleSubmitNew} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={newRegion}
            onChange={(e) => setNewRegion(e.target.value)}
            style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
          >
            <option value="US-MW">US-MW</option>
            <option value="KE-RFT">KE-RFT</option>
            <option value="BR-CEN">BR-CEN</option>
            <option value="IN-PUN">IN-PUN</option>
          </select>
          <input
            type="number"
            min="0"
            max="2000"
            value={newValue}
            onChange={(e) => setNewValue(Number(e.target.value))}
            style={{ width: '120px', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
            placeholder="Index"
          />
          <button
            type="submit"
            className="button button--primary button--small"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Observation'}
          </button>
          {!isConnected && (
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              (Wallet optional: simulates submission if not connected)
            </span>
          )}
        </form>
      </div>
    </section>
  );
}
