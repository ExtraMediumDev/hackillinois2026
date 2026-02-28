import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import { EncryptedKeypair, PlayerRecord } from '../types';

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
  return {
    player_id: uuidv4(),
    public_key: keypair.publicKey.toBase58(),
    encrypted_keypair: encryptKeypair(keypair),
    created_at: Date.now(),
  };
}
