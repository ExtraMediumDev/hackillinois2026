import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';

// @ts-ignore
import { Ignite } from '../target/types/ignite';

describe('ignite', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Ignite as Program<Ignite>;
  const authority = provider.wallet as anchor.Wallet;

  function uuidToBytes(uuid: string): Buffer {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
  }

  function makeGameId(): [string, Buffer, number[]] {
    const raw = crypto.randomUUID();
    const buf = uuidToBytes(raw);
    return [raw, buf, Array.from(buf)];
  }

  it('initialize_game creates a GameState PDA', async () => {
    const [_uuid, gameIdBuf, gameIdArr] = makeGameId();

    const [gameStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game_state'), gameIdBuf],
      program.programId
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), gameIdBuf],
      program.programId
    );

    await program.methods
      .initializeGame(gameIdArr as unknown as number[] & { length: 16 }, new anchor.BN(50000), 10)
      .accounts({
        gameState: gameStatePda,
        escrowVault: escrowPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const gameState = await program.account.gameState.fetch(gameStatePda);
    assert.equal(gameState.status, 0, 'status should be waiting (0)');
    assert.equal(gameState.gridSize, 10);
    assert.equal(gameState.buyIn.toNumber(), 50000);
    assert.equal(gameState.players.length, 0);
    console.log('✓ GameState PDA initialized:', gameStatePda.toBase58());
  });
});
