import React, { useState } from 'react';

import { useWallet } from '../wallet/WalletContext.js';

export interface CreatePolicyValues {
  farmer: string;
  cropType: string;
  regionId: string;
  plotId: string;
  coverageStartDays: number;
  coverageDurationDays: number;
  triggerCondition: 'BelowOrEqual' | 'AboveOrEqual';
  triggerThreshold: number;
  payoutAmount: number;
  premium: number;
}

export interface CreatePolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: CreatePolicyValues) => Promise<void>;
}

export function CreatePolicyModal({ isOpen, onClose, onSubmit }: CreatePolicyModalProps): React.JSX.Element | null {
  const { account } = useWallet();

  const [cropType, setCropType] = useState('Wheat');
  const [regionId, setRegionId] = useState('US-MW');
  const [plotId, setPlotId] = useState('Plot-Alpha-42');
  const [coverageStartDays, setCoverageStartDays] = useState(1);
  const [coverageDurationDays, setCoverageDurationDays] = useState(30);
  const [triggerCondition, setTriggerCondition] = useState<'BelowOrEqual' | 'AboveOrEqual'>('BelowOrEqual');
  const [triggerThreshold, setTriggerThreshold] = useState(650);
  const [payoutAmount, setPayoutAmount] = useState(2000);
  const [premium, setPremium] = useState(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const farmerAddress = account?.address || 'GBWMQ6G5PCHV7GZ3F7K4Y7YV454A6B6NNDYF4LGYIEXSDFJ6K7H2AAAA';

  // Live validations
  const maxPayoutAllowed = premium * 5;
  const isRatioValid = payoutAmount <= maxPayoutAllowed;
  const isDurationValid = coverageDurationDays >= 7 && coverageDurationDays <= 180;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isDurationValid) {
      setError('Coverage duration must be between 7 and 180 days.');
      return;
    }

    if (!isRatioValid) {
      setError(`Payout cannot exceed 5x premium (maximum payout for ${premium} USDC is ${maxPayoutAllowed} USDC).`);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        farmer: farmerAddress,
        cropType,
        regionId,
        plotId,
        coverageStartDays,
        coverageDurationDays,
        triggerCondition,
        triggerThreshold,
        payoutAmount,
        premium,
      });
      setSuccess('Policy successfully requested and created on chain!');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="panel"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#fff',
          borderRadius: '8px',
          padding: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 id="modal-title" className="panel__title" style={{ margin: 0 }}>
            🌾 Create Parametric Policy
          </h2>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            aria-label="Close modal"
            style={{ fontSize: '1.25rem', padding: '0.25rem 0.5rem' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ padding: '0.75rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', marginBottom: '1rem' }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Farmer Address (Beneficiary)
            </label>
            <input
              type="text"
              readOnly
              value={farmerAddress}
              style={{ width: '100%', padding: '0.5rem', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'monospace' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Crop Type
              </label>
              <select
                value={cropType}
                onChange={(e) => setCropType(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              >
                <option value="Wheat">Wheat</option>
                <option value="Corn">Corn</option>
                <option value="Soybean">Soybean</option>
                <option value="Coffee">Coffee</option>
                <option value="Rice">Rice</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Region Index
              </label>
              <select
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              >
                <option value="US-MW">US-MW (US Midwest)</option>
                <option value="KE-RFT">KE-RFT (Kenya Rift Valley)</option>
                <option value="BR-CEN">BR-CEN (Brazil Central)</option>
                <option value="IN-PUN">IN-PUN (India Punjab)</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Plot Identifier / Land Hash
            </label>
            <input
              type="text"
              value={plotId}
              onChange={(e) => setPlotId(e.target.value)}
              placeholder="e.g. Plot-Alpha-42"
              required
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Starts In (Days)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={coverageStartDays}
                onChange={(e) => setCoverageStartDays(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Duration (Days, 7-180)
              </label>
              <input
                type="number"
                min="7"
                max="180"
                value={coverageDurationDays}
                onChange={(e) => setCoverageDurationDays(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Trigger Condition
              </label>
              <select
                value={triggerCondition}
                onChange={(e) => setTriggerCondition(e.target.value as 'BelowOrEqual' | 'AboveOrEqual')}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              >
                <option value="BelowOrEqual">≤ Threshold (Drought / Frost)</option>
                <option value="AboveOrEqual">≥ Threshold (Flood / Heatwave)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Threshold Index Value
              </label>
              <input
                type="number"
                value={triggerThreshold}
                onChange={(e) => setTriggerThreshold(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Premium (USDC)
              </label>
              <input
                type="number"
                min="1"
                value={premium}
                onChange={(e) => setPremium(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Payout Guarantee (Max 5x)
              </label>
              <input
                type="number"
                min="1"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
              />
            </div>
          </div>

          <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.8125rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span>Coverage Multiple:</span>
              <strong>{(payoutAmount / Math.max(1, premium)).toFixed(1)}x</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Escrowed Premium:</span>
              <strong>{premium} USDC</strong>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" className="button button--ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={isSubmitting || !isRatioValid || !isDurationValid}>
              {isSubmitting ? 'Minting Policy...' : 'Confirm & Mint Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
