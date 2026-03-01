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



export interface SpliceError {
  status: 'error';
  statusCode: number;
  error: {
    code: string;
    message: string;
    remediation: string;
  };
}

// ─── Game Types ────────────────────────────────────────────────────────────────

export type GameStatus = 'waiting' | 'active' | 'resolved';

export type SettlementStatus = 'none' | 'processing' | 'completed';

export interface GamePlayer {
  player_id: string;
  pubkey: string;
  x: number;
  y: number;
  alive: boolean;
}

export interface GamePlacement {
  player_id: string;
  place: number;
}

export interface GamePayout {
  player_id: string;
  amount_usdc: string;
  status: 'pending' | 'settled' | 'simulated';
  settlement_mode: 'simulated' | 'on_chain';
}

export interface GameRecord {
  game_id: string;
  pda_address: string;
  escrow_address: string;
  buy_in_usdc: string;
  max_players: number;
  status: GameStatus;
  grid_size: number;
  grid: number[];
  players: GamePlayer[];
  prize_pool_usdc: string;
  collapse_round: number;
  move_count: number;
  winner: string | null;
  stripe_payout_initiated: boolean;
  created_at: number;
  placements?: GamePlacement[];
  payouts?: GamePayout[];
  distribution_rule?: string;
  settlement_status?: SettlementStatus;
}
