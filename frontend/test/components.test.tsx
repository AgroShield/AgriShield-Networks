import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

import { WalletProvider } from '../src/wallet/WalletContext';
import { WalletButton } from '../src/components/WalletButton';
import { CreatePolicyModal } from '../src/components/CreatePolicyModal';
import { PoolPanel } from '../src/components/PoolPanel';
import { OraclePanel } from '../src/components/OraclePanel';
import { ThemeToggle } from '../src/components/ThemeToggle';
import { ToastProvider, useToast } from '../src/components/Toast';

describe('WalletButton component', () => {
  it('renders Connect Wallet button initially', () => {
    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>,
    );

    const button = screen.getByRole('button', { name: /Connect Stellar Wallet/i });
    expect(button).toBeDefined();
    expect(button.textContent).toContain('Connect Wallet');
  });

  it('connects wallet on click and allows toggling wallet menu and disconnecting', async () => {
    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>,
    );

    const button = screen.getByRole('button', { name: /Connect Stellar Wallet/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Wallet menu/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Wallet menu/i }));
    const disconnectBtn = screen.getByRole('button', { name: /Disconnect/i });
    expect(disconnectBtn).toBeDefined();

    fireEvent.click(disconnectBtn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Connect Stellar Wallet/i })).toBeDefined();
    });
  });
});

describe('CreatePolicyModal component', () => {
  it('does not render content when isOpen is false', () => {
    render(
      <WalletProvider>
        <CreatePolicyModal isOpen={false} onClose={() => {}} onSubmit={async () => {}} />
      </WalletProvider>,
    );

    expect(screen.queryByText(/Create Parametric Policy/i)).toBeNull();
  });

  it('renders form inputs and handles submission when isOpen is true', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <WalletProvider>
        <CreatePolicyModal isOpen={true} onClose={handleClose} onSubmit={handleSubmit} />
      </WalletProvider>,
    );

    expect(screen.getByText(/Create Parametric Policy/i)).toBeDefined();
    expect(screen.getByLabelText(/Farmer Address/i)).toBeDefined();
    expect(screen.getByLabelText(/Geographic Region/i)).toBeDefined();
    expect(screen.getByLabelText(/Plot Identifier/i)).toBeDefined();
    expect(screen.getByLabelText(/Trigger Condition/i)).toBeDefined();

    // Fill plot ID
    fireEvent.change(screen.getByLabelText(/Plot Identifier/i), {
      target: { value: 'Plot-Omega-99' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Confirm & Mint Policy/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
      expect(screen.getByText(/Policy successfully requested/i)).toBeDefined();
    });
  });
});

describe('PoolPanel component', () => {
  it('renders liquidity pool reserves and solvency metrics', () => {
    render(
      <WalletProvider>
        <PoolPanel />
      </WalletProvider>,
    );

    expect(screen.getByText(/Premium Pool & Solvency/i)).toBeDefined();
    expect(screen.getByText(/Active Reserves/i)).toBeDefined();
    expect(screen.getByText(/Recognised Liability/i)).toBeDefined();
    expect(screen.getByText(/Solvency Floor/i)).toBeDefined();
  });

  it('allows depositing liquidity to the pool', async () => {
    render(
      <WalletProvider>
        <PoolPanel />
      </WalletProvider>,
    );

    const depositInput = screen.getByPlaceholderText('Amount USDC');
    fireEvent.change(depositInput, { target: { value: '2500' } });

    const depositBtn = screen.getByRole('button', { name: /Deposit to Pool/i });
    fireEvent.click(depositBtn);

    await waitFor(() => {
      expect(screen.getByText(/Successfully deposited 2,500 USDC to reserve pool!/i)).toBeDefined();
    });
  });
});

describe('OraclePanel component', () => {
  it('renders regional readings and pending approvals', () => {
    render(
      <WalletProvider>
        <OraclePanel />
      </WalletProvider>,
    );

    expect(screen.getByText(/Weather Oracle & Threshold Signers/i)).toBeDefined();
    expect(screen.getByText('US-MW Index')).toBeDefined();
    expect(screen.getByText('KE-RFT Index')).toBeDefined();
    expect(screen.getByText('Pending Observations Awaiting Co-signature')).toBeDefined();
  });

  it('allows co-signing pending observations', async () => {
    render(
      <WalletProvider>
        <OraclePanel />
      </WalletProvider>,
    );

    const cosignButtons = screen.getAllByRole('button', { name: /Co-sign Reading/i });
    expect(cosignButtons.length).toBeGreaterThan(0);

    fireEvent.click(cosignButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Reading co-signed and threshold met!/i)).toBeDefined();
    });
  });

  it('allows submitting a new observation', async () => {
    render(
      <WalletProvider>
        <OraclePanel />
      </WalletProvider>,
    );

    const submitBtn = screen.getByRole('button', { name: /Submit Observation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/New reading observation submitted/i)).toBeDefined();
    });
  });
});

describe('ThemeToggle component', () => {
  it('toggles theme between light and dark', () => {
    render(<ThemeToggle />);

    const toggleBtn = screen.getByRole('button', { name: /Switch to/i });
    const initialText = toggleBtn.textContent;

    fireEvent.click(toggleBtn);
    expect(toggleBtn.textContent).not.toBe(initialText);
  });
});

function TestToastConsumer() {
  const { showToast } = useToast();
  return (
    <div>
      <button onClick={() => showToast('Action succeeded!', 'success')}>Trigger Success</button>
      <button onClick={() => showToast('Error occurred!', 'error')}>Trigger Error</button>
    </div>
  );
}

describe('Toast notification system', () => {
  it('renders toast notification on showToast call and dismisses on close button', async () => {
    render(
      <ToastProvider>
        <TestToastConsumer />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Success' }));

    expect(screen.getByText('Action succeeded!')).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Action succeeded!')).toBeNull();
    });
  });
});
