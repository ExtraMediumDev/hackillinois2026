export interface EncryptedKeypair {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export type WalletLifecycleState = 'active' | 'inactive' | 'pending_close' | 'closed';

export interface PlayerRecord {
  player_id: string;
  public_key: string;
  encrypted_keypair: EncryptedKeypair;
  stripe_connect_account_id?: string;
  wallet_state: WalletLifecycleState;
  last_active_at: number;
  inactive_since?: number;
  closed_at?: number;
  pending_payout?: boolean;
  pending_onchain_settlement?: boolean;
  created_at: number;
}

export interface IdempotencyRecord {
  status: 'processing' | 'completed';
  response?: unknown;
  created_at: number;
}



export interface IgniteError {
  status: 'error';
  statusCode: number;
  error: {
    code: string;
    message: string;
    remediation: string;
  };
}
