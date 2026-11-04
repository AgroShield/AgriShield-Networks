import React, { useState } from 'react';

import { useWallet } from '../wallet/WalletContext.js';
import { Field, FieldGrid } from './Field.js';
import { StatusChip } from './StatusChip.js';

export interface PoolStats {
  reserves: bigint;
  outstandingLiability: bigint;
  minSolvencyRatioBps: number;
  totalDeposited: bigint;
  totalReleased: bigint;
  totalWithdrawn: bigint;
}

export function PoolPanel(): React.JSX.Element {
  const { isConnected, signTransaction } = useWallet();

  const [stats, setStats] = useState<PoolStats>({
    reserves: 250_000_0000000n, // 250,000 USDC
    outstandingLiability: 150_000_0000000n, // 150,000 USDC
    minSolvencyRatioBps: 12000, // 120%
    totalDeposited: 300_000_0000000n,
    totalReleased: 40_000_0000000n,
    totalWithdrawn: 10_000_0000000n,
  });

  const [depositAmount, setDepositAmount] = useState<number>(1000);
  const [isDepositing, setIsDepositing] = useState(false);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);

  const stroopsToUSDC = (stroops: bigint): string => {
    return (Number(stroops) / 10_000_000).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    });
  };

  const ratioBps =
    stats.outstandingLiability === 0n
      ? 100_000
      : Number((stats.reserves * 10_000n) / stats.outstandingLiability);
  const ratioPercent = (ratioBps / 100).toFixed(1);
  const isSolvent = ratioBps >= stats.minSolvencyRatioBps;

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (depositAmount <= 0) return;

    setIsDepositing(true);
    setTxSuccess(null);
    try {
      if (isConnected) {
        await signTransaction(`mock-xdr-deposit-${depositAmount}`);
      }
      const added = BigInt(depositAmount) * 10_000_000n;
      setStats((prev) => ({
        ...prev,
        reserves: prev.reserves + added,
        totalDeposited: prev.totalDeposited + added,
      }));
      setTxSuccess(`Successfully deposited ${depositAmount.toLocaleString()} USDC to reserve pool!`);
      setTimeout(() => setTxSuccess(null), 4000);
    } catch {
      // Handled
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <section className="panel" aria-label="Premium Pool & Liquidity">
      <header className="panel__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="panel__title">💧 Premium Pool & Solvency</h2>
        <StatusChip
          label={isSolvent ? `Solvent (${ratioPercent}%)` : `Undercollateralized (${ratioPercent}%)`}
          tone={isSolvent ? 'success' : 'failure'}
        />
      </header>

      <p className="muted" style={{ margin: '0 0 1rem 0' }}>
        Capital pool backing farmer policy liabilities. The pool enforces a minimum solvency ratio
        floor of {(stats.minSolvencyRatioBps / 100).toFixed(0)}%.
      </p>

      <FieldGrid>
        <Field label="Active Reserves">{stroopsToUSDC(stats.reserves)} USDC</Field>
        <Field label="Recognised Liability">{stroopsToUSDC(stats.outstandingLiability)} USDC</Field>
        <Field label="Solvency Floor">{(stats.minSolvencyRatioBps / 100).toFixed(0)}%</Field>
        <Field label="Total Capital Deposited">{stroopsToUSDC(stats.totalDeposited)} USDC</Field>
        <Field label="Total Claims Paid">{stroopsToUSDC(stats.totalReleased)} USDC</Field>
        <Field label="Total Withdrawn">{stroopsToUSDC(stats.totalWithdrawn)} USDC</Field>
      </FieldGrid>

      <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e5e7eb' }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
          Deposit Liquidity
        </h4>
        {txSuccess && (
          <div style={{ padding: '0.5rem 0.75rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            {txSuccess}
          </div>
        )}
        <form onSubmit={handleDeposit} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="number"
            min="10"
            step="10"
            value={depositAmount}
            onChange={(e) => setDepositAmount(Number(e.target.value))}
            style={{ width: '160px', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '4px' }}
            placeholder="Amount USDC"
            aria-label="Deposit amount"
          />
          <button
            type="submit"
            className="button button--secondary"
            disabled={isDepositing || depositAmount <= 0}
          >
            {isDepositing ? 'Depositing...' : 'Deposit to Pool'}
          </button>
        </form>
      </div>
    </section>
  );
}
