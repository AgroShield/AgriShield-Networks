import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { defaultWalletAdapter } from './adapter.js';
import type { IWalletAdapter, SupportedWallet, WalletAccount, WalletState } from './types.js';

interface WalletContextValue extends WalletState {
  connect: (walletId?: SupportedWallet) => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export interface WalletProviderProps {
  children: ReactNode;
  adapter?: IWalletAdapter;
}

export function WalletProvider({ children, adapter = defaultWalletAdapter }: WalletProviderProps): React.JSX.Element {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adapter.getAccount().then((acc) => {
      if (acc) setAccount(acc);
    });
  }, [adapter]);

  const connect = async (walletId?: SupportedWallet): Promise<void> => {
    setIsConnecting(true);
    setError(null);
    try {
      const connected = await adapter.connect(walletId);
      setAccount(connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connection failed');
      throw err;
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setError(null);
    await adapter.disconnect();
    setAccount(null);
  };

  const signTransaction = async (xdr: string, opts?: { networkPassphrase?: string }): Promise<string> => {
    return await adapter.signTransaction(xdr, opts);
  };

  const value: WalletContextValue = {
    account,
    isConnected: account !== null,
    isConnecting,
    error,
    connect,
    disconnect,
    signTransaction,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}
