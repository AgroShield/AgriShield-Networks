import type { IWalletAdapter, SupportedWallet, WalletAccount } from './types.js';

interface FreighterWindow {
  isConnected?: () => Promise<boolean>;
  getPublicKey?: () => Promise<string>;
  signTransaction?: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>;
}

declare global {
  interface Window {
    freighter?: FreighterWindow;
    stellar?: {
      isConnected?: () => Promise<boolean>;
      getPublicKey?: () => Promise<string>;
    };
  }
}

const STORAGE_KEY = 'agrishield_connected_wallet';

export class StellarWalletAdapter implements IWalletAdapter {
  private activeAccount: WalletAccount | null = null;

  constructor() {
    this.restoreSession();
  }

  private restoreSession(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          this.activeAccount = JSON.parse(stored);
        }
      }
    } catch {
      // Ignore localStorage access restrictions
    }
  }

  private persistSession(account: WalletAccount | null): void {
    this.activeAccount = account;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (account) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // Ignore
    }
  }

  async getAccount(): Promise<WalletAccount | null> {
    return this.activeAccount;
  }

  async connect(walletId: SupportedWallet = 'freighter'): Promise<WalletAccount> {
    if (walletId === 'demo') {
      // Demo / Test account for offline testing
      const demoAccount: WalletAccount = {
        address: 'GBWMQ6G5PCHV7GZ3F7K4Y7YV454A6B6NNDYF4LGYIEXSDFJ6K7H2AAAA',
        walletName: 'Demo Farmer Account',
      };
      this.persistSession(demoAccount);
      return demoAccount;
    }

    if (typeof window !== 'undefined' && window.freighter && typeof window.freighter.getPublicKey === 'function') {
      try {
        const isConnected = window.freighter.isConnected
          ? await window.freighter.isConnected()
          : true;
        if (!isConnected) {
          throw new Error('Freighter wallet extension is locked or not connected');
        }
        const publicKey = await window.freighter.getPublicKey();
        if (!publicKey) {
          throw new Error('User declined wallet connection request');
        }
        const account: WalletAccount = {
          address: publicKey,
          walletName: 'Freighter',
        };
        this.persistSession(account);
        return account;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : 'Failed to connect to Freighter wallet');
      }
    }

    // Fallback: If no browser extension detected, provide interactive demo address with notice
    const fallbackAccount: WalletAccount = {
      address: 'GD6W5F5K32LKKNMX7KWWXQOXZQ6YYW2P7X432W25KMXQOWW7XZKWWAAA',
      walletName: 'Web3 Simulated Wallet (Freighter Extension Not Detected)',
    };
    this.persistSession(fallbackAccount);
    return fallbackAccount;
  }

  async disconnect(): Promise<void> {
    this.persistSession(null);
  }

  async signTransaction(xdr: string, opts?: { networkPassphrase?: string }): Promise<string> {
    if (!this.activeAccount) {
      throw new Error('No wallet connected. Please connect your wallet first.');
    }

    if (typeof window !== 'undefined' && window.freighter?.signTransaction) {
      return await window.freighter.signTransaction(xdr, opts);
    }

    // In simulated or test environment, return input XDR with confirmation
    return xdr;
  }
}

export const defaultWalletAdapter = new StellarWalletAdapter();
