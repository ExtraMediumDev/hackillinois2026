import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getPlayer } from '../services/redis';
import { saveGame, getGame } from '../services/redis';
import { decryptKeypair } from '../services/wallet';
import {
  getConnection,
  getAuthority,
  buildAndSendTransaction,
  getTokenBalance,
  getGameStatePda,
  getEscrowPda,
} from '../services/solana';
import { withIdempotency } from '../services/idempotency';
import { GameRecord, PlayerState, GameStatus } from '../types';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

const GRID_SIZE = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initGrid(size: number): number[] {
  return new Array(size * size).fill(0); // all safe
}

function uuidToBytes(id: string): Buffer {
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

function collapseGrid(game: GameRecord): { newGrid: number[]; eliminatedPlayers: string[] } {
  const newGrid = [...game.grid];
  const tilesToCollapse: number[] = [];

  // Collapse ~20% of safe tiles randomly (deterministic by round seed in real impl)
  for (let i = 0; i < newGrid.length; i++) {
    if (newGrid[i] === 0 && Math.random() < 0.2) {
      tilesToCollapse.push(i);
    }
  }
  for (const idx of tilesToCollapse) newGrid[idx] = 1;

  // Eliminate players on lava tiles
  const eliminatedPlayers: string[] = [];
  for (const p of game.players) {
    const idx = p.y * game.grid_size + p.x;
    if (newGrid[idx] === 1 && p.alive) {
      p.alive = false;
      eliminatedPlayers.push(p.pubkey);
    }
  }

  return { newGrid, eliminatedPlayers };
}

function buildIgniteInstruction(
  programId: PublicKey,
  discriminator: number[],
  data: Buffer,
  accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
): TransactionInstruction {
  const disc = Buffer.from(discriminator);
  return new TransactionInstruction({
    programId,
    keys: accounts,
    data: Buffer.concat([disc, data]),
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export default async function gameRoutes(app: FastifyInstance): Promise<void> {
  const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? PublicKey.default.toBase58());

  /**
   * POST /v1/games
   * Creates a new game room and initializes the on-chain PDA.
   */
  app.post(
    '/games',
    async (
      request: FastifyRequest<{
        Body: { buy_in_usdc?: string; max_players?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { buy_in_usdc = '0.05', max_players = 4 } = request.body ?? {};

      if (max_players < 2 || max_players > 10) {
        return reply.code(400).send({
          status: 'error',
          statusCode: 400,
          error: {
            code: 'INVALID_PARAMETERS',
            message: 'max_players must be between 2 and 10.',
            remediation: 'Provide a valid max_players value.',
          },
        });
      }

      const gameId = uuidv4();
      const gameIdBytes = uuidToBytes(gameId);
      const [pdaAddress] = getGameStatePda(gameIdBytes);
      const [escrowAddress] = getEscrowPda(gameIdBytes);

      // Build initialize_game instruction
      // Discriminator: sha256("global:initialize_game")[0..8]
      const discriminator = [77, 185, 167, 252, 172, 129, 21, 126];
      const buyInLamports = Math.round(parseFloat(buy_in_usdc) * 1e6); // USDC has 6 decimals
      const data = Buffer.alloc(16 + 8 + 1);
      gameIdBytes.copy(data, 0);
      data.writeBigUInt64LE(BigInt(buyInLamports), 16);
      data.writeUInt8(GRID_SIZE, 24);

      const authority = getAuthority();

      try {
        await buildAndSendTransaction(
          [
            buildIgniteInstruction(PROGRAM_ID, discriminator, data, [
              { pubkey: pdaAddress, isSigner: false, isWritable: true },
              { pubkey: escrowAddress, isSigner: false, isWritable: true },
              { pubkey: authority.publicKey, isSigner: true, isWritable: true },
              { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ]),
          ],
          []
        );
      } catch (err) {
        app.log.warn({ err }, 'initialize_game on-chain failed — proceeding in simulation mode');
        // For demo/testing without deployed program, we proceed with Redis-only state
      }

      const game: GameRecord = {
        game_id: gameId,
        pda_address: pdaAddress.toBase58(),
        escrow_address: escrowAddress.toBase58(),
        buy_in_usdc,
        max_players,
        status: 'waiting',
        grid_size: GRID_SIZE,
        grid: initGrid(GRID_SIZE),
        players: [],
        prize_pool_usdc: '0',
        collapse_round: 0,
        stripe_payout_initiated: false,
        created_at: Date.now(),
      };

      await saveGame(game);

      return reply.code(201).send({
        game_id: game.game_id,
        pda_address: game.pda_address,
        escrow_address: game.escrow_address,
        buy_in_usdc: game.buy_in_usdc,
        max_players: game.max_players,
        status: game.status,
      });
    }
  );

  /**
   * GET /v1/games/:id
   * Returns full game state.
   */
  app.get(
    '/games/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const game = await getGame(request.params.id);
      if (!game) {
        return reply.code(404).send({
          status: 'error',
          statusCode: 404,
          error: {
            code: 'GAME_NOT_FOUND',
            message: `Game ${request.params.id} not found.`,
            remediation: 'Create a game first via POST /v1/games.',
          },
        });
      }
      return reply.send(game);
    }
  );

  /**
   * POST /v1/games/:id/join
   * Player joins a game room (idempotency-keyed).
   */
  app.post(
    '/games/:id/join',
    {
      preHandler: [
        (req: FastifyRequest, rep: FastifyReply, done: () => void) => {
          void withIdempotency(async (r, rp) => {
            await joinHandler(r as FastifyRequest<{ Params: { id: string }; Body: { player_id: string } }>, rp);
          })(req, rep);
          done();
        },
      ],
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { player_id: string } }>,
      reply: FastifyReply
    ) => {
      return joinHandler(request, reply);
    }
  );

  async function joinHandler(
    request: FastifyRequest<{ Params: { id: string }; Body: { player_id: string } }>,
    reply: FastifyReply
  ): Promise<unknown> {
    const { id: gameId } = request.params;
    const { player_id } = request.body;

    const [game, player] = await Promise.all([getGame(gameId), getPlayer(player_id)]);

    if (!game) {
      return reply.code(404).send({
        status: 'error',
        statusCode: 404,
        error: {
          code: 'GAME_NOT_FOUND',
          message: `Game ${gameId} not found.`,
          remediation: 'Create a game first via POST /v1/games.',
        },
      });
    }

    if (!player) {
      return reply.code(404).send({
        status: 'error',
        statusCode: 404,
        error: {
          code: 'PLAYER_NOT_FOUND',
          message: `Player ${player_id} not found.`,
          remediation: 'Create a player first via POST /v1/players.',
        },
      });
    }

    if (game.status !== 'waiting') {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'GAME_NOT_JOINABLE',
          message: `Game is currently ${game.status} and cannot accept new players.`,
          remediation: 'Create a new game via POST /v1/games.',
        },
      });
    }

    if (game.players.length >= game.max_players) {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'GAME_FULL',
          message: 'This game is already full.',
          remediation: 'Join a different game or create a new one.',
        },
      });
    }

    if (game.players.find((p) => p.pubkey === player.public_key)) {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'ALREADY_JOINED',
          message: 'This player has already joined this game.',
          remediation: 'Use a different Idempotency-Key to force a new join.',
        },
      });
    }

    // Check USDC balance
    const usdcBalance = await getTokenBalance(player.public_key, process.env.USDC_MINT!);
    const buyIn = parseFloat(game.buy_in_usdc);
    if (usdcBalance < buyIn) {
      return reply.code(402).send({
        status: 'error',
        statusCode: 402,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: `Your burner wallet lacks the ${game.buy_in_usdc} USDC required to join this game.`,
          remediation: 'Call POST /v1/players to get a Stripe top-up link.',
        },
      });
    }

    // Find an open starting tile
    let startX = 0, startY = 0;
    outer: for (let y = 0; y < game.grid_size; y++) {
      for (let x = 0; x < game.grid_size; x++) {
        const idx = y * game.grid_size + x;
        if (game.grid[idx] === 0 && !game.players.find((p) => p.x === x && p.y === y)) {
          startX = x;
          startY = y;
          break outer;
        }
      }
    }

    // Build join_game instruction
    const discriminator = [107, 112, 18, 38, 56, 173, 60, 71];
    const gameIdBytes = uuidToBytes(gameId);
    const playerPubkey = new PublicKey(player.public_key);
    const data = Buffer.alloc(16 + 32 + 1 + 1);
    gameIdBytes.copy(data, 0);
    playerPubkey.toBytes().forEach((b, i) => data.writeUInt8(b, 16 + i));
    data.writeUInt8(startX, 48);
    data.writeUInt8(startY, 49);

    const [pdaAddress] = getGameStatePda(gameIdBytes);
    const [escrowAddress] = getEscrowPda(gameIdBytes);
    const burnerKeypair = decryptKeypair(player.encrypted_keypair);

    try {
      await buildAndSendTransaction(
        [
          buildIgniteInstruction(PROGRAM_ID, discriminator, data, [
            { pubkey: pdaAddress, isSigner: false, isWritable: true },
            { pubkey: escrowAddress, isSigner: false, isWritable: true },
            { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
          ]),
        ],
        [burnerKeypair]
      );
    } catch (err) {
      app.log.warn({ err }, 'join_game on-chain failed — proceeding in simulation mode');
    }

    // Update game state
    const newPlayer: PlayerState = {
      pubkey: player.public_key,
      x: startX,
      y: startY,
      alive: true,
    };
    game.players.push(newPlayer);
    game.prize_pool_usdc = (parseFloat(game.prize_pool_usdc) + buyIn).toFixed(6);

    // Auto-start if full
    if (game.players.length >= game.max_players) {
      game.status = 'active';
    }

    await saveGame(game);

    const result = {
      game_id: game.game_id,
      player_id,
      start_x: startX,
      start_y: startY,
      status: game.status,
    };

    return reply.code(200).send(result);
  }

  /**
   * POST /v1/games/:id/move
   * Player moves on the grid (idempotency-keyed).
   */
  app.post(
    '/games/:id/move',
    {
      preHandler: [
        (req: FastifyRequest, rep: FastifyReply, done: () => void) => {
          void withIdempotency(async (r, rp) => {
            await moveHandler(
              r as FastifyRequest<{ Params: { id: string }; Body: { player_id: string; direction: string } }>,
              rp
            );
          })(req, rep);
          done();
        },
      ],
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { player_id: string; direction: string };
      }>,
      reply: FastifyReply
    ) => {
      return moveHandler(request, reply);
    }
  );

  async function moveHandler(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { player_id: string; direction: string };
    }>,
    reply: FastifyReply
  ): Promise<unknown> {
    const { id: gameId } = request.params;
    const { player_id, direction } = request.body;

    const [game, player] = await Promise.all([getGame(gameId), getPlayer(player_id)]);

    if (!game) {
      return reply.code(404).send({
        status: 'error',
        statusCode: 404,
        error: {
          code: 'GAME_NOT_FOUND',
          message: `Game ${gameId} not found.`,
          remediation: 'Check the game_id.',
        },
      });
    }

    if (game.status !== 'active') {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'GAME_NOT_ACTIVE',
          message: `Game is ${game.status}. Moves are only valid in active games.`,
          remediation: 'Wait for enough players to join to start the game.',
        },
      });
    }

    const playerState = game.players.find((p) => p.pubkey === player?.public_key);
    if (!playerState) {
      return reply.code(404).send({
        status: 'error',
        statusCode: 404,
        error: {
          code: 'PLAYER_NOT_IN_GAME',
          message: 'Player is not part of this game.',
          remediation: 'Join the game first via POST /v1/games/:id/join.',
        },
      });
    }

    if (!playerState.alive) {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'PLAYER_ELIMINATED',
          message: 'Player has been eliminated. No more moves allowed.',
          remediation: 'Create a new game to play again.',
        },
      });
    }

    // Compute new position
    const dirMap: Record<string, [number, number]> = {
      up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    };
    const delta = dirMap[direction.toLowerCase()];
    if (!delta) {
      return reply.code(400).send({
        status: 'error',
        statusCode: 400,
        error: {
          code: 'INVALID_DIRECTION',
          message: `"${direction}" is not a valid direction. Use up, down, left, or right.`,
          remediation: 'Provide a valid direction.',
        },
      });
    }

    const newX = playerState.x + delta[0];
    const newY = playerState.y + delta[1];

    if (newX < 0 || newX >= game.grid_size || newY < 0 || newY >= game.grid_size) {
      return reply.code(400).send({
        status: 'error',
        statusCode: 400,
        error: {
          code: 'OUT_OF_BOUNDS',
          message: 'Move would take player off the grid.',
          remediation: 'Choose a different direction.',
        },
      });
    }

    const targetIdx = newY * game.grid_size + newX;
    if (game.grid[targetIdx] === 1) {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'TILE_IS_LAVA',
          message: 'That tile has already collapsed. Choose a safe tile.',
          remediation: 'Pick a different direction.',
        },
      });
    }

    // Build submit_move instruction
    if (player) {
      const discriminator = [53, 87, 164, 21, 43, 192, 78, 34];
      const gameIdBytes = uuidToBytes(gameId);
      const data = Buffer.alloc(16 + 1 + 1);
      gameIdBytes.copy(data, 0);
      data.writeUInt8(newX, 16);
      data.writeUInt8(newY, 17);

      const [pdaAddress] = getGameStatePda(gameIdBytes);
      const burnerKeypair = decryptKeypair(player.encrypted_keypair);

      try {
        await buildAndSendTransaction(
          [
            buildIgniteInstruction(PROGRAM_ID, discriminator, data, [
              { pubkey: pdaAddress, isSigner: false, isWritable: true },
              { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: false },
              { pubkey: getAuthority().publicKey, isSigner: true, isWritable: false },
            ]),
          ],
          [burnerKeypair]
        );
      } catch (err) {
        app.log.warn({ err }, 'submit_move on-chain failed — simulation mode');
      }
    }

    // Update player position
    playerState.x = newX;
    playerState.y = newY;

    // Trigger collapse every 3 moves (by total move count)
    const totalMoves = game.players.reduce((acc, p) => acc + (p.alive ? 1 : 0), 0);
    let newStatus: GameStatus = game.status;

    if (totalMoves % 3 === 0) {
      const { newGrid } = collapseGrid(game);
      game.grid = newGrid;
      game.collapse_round += 1;
    }

    // Check for winner
    const alivePlayers = game.players.filter((p) => p.alive);
    if (alivePlayers.length === 1) {
      game.winner = alivePlayers[0].pubkey;
      game.status = 'resolved';
      newStatus = 'resolved';
      // Payout trigger happens in background (or via webhooks in production)
      game.stripe_payout_initiated = true;
    } else if (alivePlayers.length === 0) {
      game.status = 'resolved';
      newStatus = 'resolved';
    }

    await saveGame(game);

    return reply.send({
      game_id: game.game_id,
      player_id,
      new_x: newX,
      new_y: newY,
      alive: playerState.alive,
      status: newStatus,
      winner: game.winner,
      grid_snapshot: game.grid,
      collapse_round: game.collapse_round,
    });
  }
}
