export interface EncryptedKeypair {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface PlayerRecord {
  player_id: string;
  public_key: string;
  encrypted_keypair: EncryptedKeypair;
  stripe_connect_account_id?: string;
  created_at: number;
}

export interface IdempotencyRecord {
  status: 'processing' | 'completed';
  response?: unknown;
  created_at: number;
}



export interface SpliceError {
  status: 'error';
  statusCode: number;
  error: {
    code: string;
    message: string;
    remediation: string;
  };
}
