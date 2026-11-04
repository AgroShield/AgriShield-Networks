export type SupportedWallet = 'freighter' | 'xbull' | 'lobstr' | 'albedo' | 'demo';

export interface WalletAccount {
  readonly address: string;
  readonly walletName: string;
}

export interface WalletState {
  readonly account: WalletAccount | null;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly error: string | null;
}

export interface IWalletAdapter {
  connect(walletId?: SupportedWallet): Promise<WalletAccount>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, opts?: { networkPassphrase?: string }): Promise<string>;
  getAccount(): Promise<WalletAccount | null>;
}
