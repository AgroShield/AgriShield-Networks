import React, { useState } from 'react';

import { useWallet } from '../wallet/WalletContext.js';

export function WalletButton(): React.JSX.Element {
  const { account, isConnected, isConnecting, connect, disconnect } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  const shortenAddress = (addr: string) => {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  if (!isConnected) {
    return (
      <div className="wallet-button-container">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void connect('freighter')}
          disabled={isConnecting}
          aria-label="Connect Stellar Wallet"
        >
          {isConnecting ? 'Connecting...' : '🔌 Connect Wallet'}
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-button-container" style={{ position: 'relative' }}>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => setMenuOpen(!menuOpen)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        aria-label="Wallet menu"
      >
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981',
          }}
        />
        <span>{shortenAddress(account!.address)}</span>
      </button>

      {menuOpen && (
        <div
          className="panel"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: '280px',
            padding: '1rem',
            zIndex: 100,
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div style={{ marginBottom: '0.75rem' }}>
            <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>
              Connected via {account!.walletName}
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
                wordBreak: 'break-all',
                marginTop: '0.25rem',
              }}
            >
              {account!.address}
            </div>
          </div>
          <button
            type="button"
            className="button button--ghost"
            style={{ width: '100%', color: '#ef4444' }}
            onClick={() => {
              setMenuOpen(false);
              void disconnect();
            }}
          >
            Disconnect Wallet
          </button>
        </div>
      )}
    </div>
  );
}
