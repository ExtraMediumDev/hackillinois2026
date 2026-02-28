import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  AccountChangeCallback,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import fs from 'fs';

// ─── Connection + Authority ───────────────────────────────────────────────────
let _connection: Connection | null = null;
let _authority: Keypair | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');
  }
  return _connection;
}

export function getAuthority(): Keypair {
  if (!_authority) {
    const keyPath = process.env.AUTHORITY_KEYPAIR_PATH!;
    const raw = JSON.parse(fs.readFileSync(keyPath, 'utf-8')) as number[];
    _authority = Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  return _authority;
}

// ─── Token Balance ────────────────────────────────────────────────────────────
export async function getTokenBalance(pubkey: string, mint: string): Promise<number> {
  const conn = getConnection();
  const owner = new PublicKey(pubkey);
  const mintPubkey = new PublicKey(mint);
  try {
    const ata = getAssociatedTokenAddressSync(mintPubkey, owner);
    const balance = await conn.getTokenAccountBalance(ata);
    return parseFloat(balance.value.uiAmountString ?? '0');
  } catch {
    return 0; // ATA doesn't exist yet
  }
}

// ─── SOL Balance ──────────────────────────────────────────────────────────────
export async function getSolBalance(pubkey: string): Promise<number> {
  const conn = getConnection();
  const lamports = await conn.getBalance(new PublicKey(pubkey));
  return lamports / 1e9;
}

// ─── Transaction Builder + Sender ────────────────────────────────────────────
const DEFAULT_PRIORITY_FEE = 10_000; // microlamports

async function estimatePriorityFee(): Promise<number> {
  try {
    const conn = getConnection();
    // Helius priority fee API
    const resp = await fetch(`${process.env.SOLANA_RPC_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getPriorityFeeEstimate',
        params: [{ options: { priorityLevel: 'High' } }],
      }),
    });
    const data = await resp.json() as { result?: { priorityFeeEstimate?: number } };
    return data?.result?.priorityFeeEstimate ?? DEFAULT_PRIORITY_FEE;
  } catch {
    return DEFAULT_PRIORITY_FEE;
  }
}

export async function buildAndSendTransaction(
  instructions: TransactionInstruction[],
  signers: Keypair[]
): Promise<string> {
  const conn = getConnection();
  const authority = getAuthority();

  const priorityFee = await estimatePriorityFee();

  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    ...instructions
  );

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = authority.publicKey;

  const allSigners = [authority, ...signers];
  const sig = await sendAndConfirmTransaction(conn, tx, allSigners, {
    commitment: 'confirmed',
    maxRetries: 3,
  });

  return sig;
}

// ─── WebSocket Account Watch ──────────────────────────────────────────────────
export function watchAccount(pubkey: string, callback: AccountChangeCallback): number {
  const conn = getConnection();
  return conn.onAccountChange(new PublicKey(pubkey), callback, 'confirmed');
}

export function unwatchAccount(subscriptionId: number): void {
  getConnection().removeAccountChangeListener(subscriptionId);
}

// ─── PDA Helpers ──────────────────────────────────────────────────────────────
export function getGameStatePda(gameIdBytes: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game_state'), gameIdBytes],
    new PublicKey(process.env.PROGRAM_ID!)
  );
}

export function getEscrowPda(gameIdBytes: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), gameIdBytes],
    new PublicKey(process.env.PROGRAM_ID!)
  );
}

// ─── Transaction History ──────────────────────────────────────────────────────
export async function getTransactionHistory(
  pubkey: string,
  limit = 20
): Promise<{ signature: string; blockTime: number | null | undefined }[]> {
  const conn = getConnection();
  const sigs = await conn.getSignaturesForAddress(new PublicKey(pubkey), { limit });
  return sigs.map((s) => ({ signature: s.signature, blockTime: s.blockTime }));
}
