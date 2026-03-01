import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import { EncryptedKeypair, PlayerRecord, WalletLifecycleState } from '../types';

function getEncryptionKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function generateKeypair(): Keypair {
  return Keypair.generate();
}

export function encryptKeypair(keypair: Keypair): EncryptedKeypair {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const secretKeyBytes = Buffer.from(keypair.secretKey);
  const ciphertext = Buffer.concat([cipher.update(secretKeyBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

export function decryptKeypair(payload: EncryptedKeypair): Keypair {
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const secretKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return Keypair.fromSecretKey(secretKey);
}

export function createPlayerRecord(keypair: Keypair): PlayerRecord {
  const now = Date.now();
  return {
    player_id: uuidv4(),
    public_key: keypair.publicKey.toBase58(),
    encrypted_keypair: encryptKeypair(keypair),
    wallet_state: 'active',
    last_active_at: now,
    created_at: now,
  };
}

/**
 * Backward-compatible lifecycle defaults for existing players in Redis.
 */
export function ensurePlayerLifecycleFields(player: PlayerRecord): PlayerRecord {
  const normalized: PlayerRecord = { ...player };
  const now = Date.now();

  if (!normalized.wallet_state) {
    normalized.wallet_state = 'active';
  }
  if (!normalized.last_active_at) {
    normalized.last_active_at = normalized.created_at ?? now;
  }

  return normalized;
}

export function markPlayerActive(player: PlayerRecord): PlayerRecord {
  const next = ensurePlayerLifecycleFields(player);
  next.wallet_state = 'active';
  next.last_active_at = Date.now();
  delete next.inactive_since;
  delete next.closed_at;
  return next;
}

export function markPlayerInactive(player: PlayerRecord): PlayerRecord {
  const next = ensurePlayerLifecycleFields(player);
  if (!next.inactive_since) {
    next.inactive_since = Date.now();
  }
  next.wallet_state = 'inactive';
  return next;
}
