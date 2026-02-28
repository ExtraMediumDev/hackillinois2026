import { Redis } from '@upstash/redis';
import { PlayerRecord, GameRecord, IdempotencyRecord } from '../types';

let _client: Redis | null = null;

function getClient(): Redis {
  if (!_client) {
    _client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _client;
}

// ─── Key Helpers ─────────────────────────────────────────────────────────────
const playerKey = (id: string) => `player:${id}`;
const gameKey = (id: string) => `game:${id}`;
const idempotentKey = (key: string) => `idempotent:${key}`;

// TTLs (seconds)
const PLAYER_TTL = 60 * 60 * 24;       // 24 hours
const GAME_TTL = 60 * 60 * 24 * 7;     // 7 days
const IDEMPOTENT_TTL = 60 * 60 * 24;   // 24 hours

// ─── Player ──────────────────────────────────────────────────────────────────
export async function savePlayer(player: PlayerRecord): Promise<void> {
  await getClient().set(playerKey(player.player_id), JSON.stringify(player), { ex: PLAYER_TTL });
}

export async function getPlayer(id: string): Promise<PlayerRecord | null> {
  const raw = await getClient().get<string>(playerKey(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PlayerRecord);
}

// ─── Game ─────────────────────────────────────────────────────────────────────
export async function saveGame(game: GameRecord): Promise<void> {
  await getClient().set(gameKey(game.game_id), JSON.stringify(game), { ex: GAME_TTL });
}

export async function getGame(id: string): Promise<GameRecord | null> {
  const raw = await getClient().get<string>(gameKey(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as GameRecord);
}

// ─── Idempotency ──────────────────────────────────────────────────────────────
export async function getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
  const raw = await getClient().get<string>(idempotentKey(key));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as IdempotencyRecord);
}

/** SET NX — returns true if lock was acquired */
export async function setIdempotencyProcessing(key: string): Promise<boolean> {
  const record: IdempotencyRecord = { status: 'processing', created_at: Date.now() };
  const result = await getClient().set(
    idempotentKey(key),
    JSON.stringify(record),
    { ex: IDEMPOTENT_TTL, nx: true }
  );
  return result === 'OK';
}

export async function setIdempotencyCompleted(key: string, response: unknown): Promise<void> {
  const record: IdempotencyRecord = { status: 'completed', response, created_at: Date.now() };
  await getClient().set(idempotentKey(key), JSON.stringify(record), { ex: IDEMPOTENT_TTL });
}
