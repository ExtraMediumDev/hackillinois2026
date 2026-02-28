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

export interface PlayerState {
  pubkey: string;
  x: number;
  y: number;
  alive: boolean;
}

export type GameStatus = 'waiting' | 'active' | 'resolved';

export interface GameRecord {
  game_id: string;
  pda_address: string;
  escrow_address: string;
  buy_in_usdc: string;
  max_players: number;
  status: GameStatus;
  grid_size: number;
  grid: number[];       // flattened: 0=safe, 1=lava
  players: PlayerState[];
  winner?: string;
  prize_pool_usdc: string;
  collapse_round: number;
  stripe_payout_initiated: boolean;
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
