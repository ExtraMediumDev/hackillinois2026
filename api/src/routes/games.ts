import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { saveGame, getGame, getPlayer } from '../services/redis';
import { withIdempotency } from '../services/idempotency';
import { getTokenBalance } from '../services/solana';
import { GameRecord, GamePlayer, SpliceError } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spliceError(code: string, statusCode: number, message: string, remediation: string): SpliceError {
  return { status: 'error', statusCode, error: { code, message, remediation } };
}

const GRID_SIZE = 10;
const MOVES_PER_COLLAPSE = 3;
const COLLAPSE_PERCENT = 0.2;

function isValidMoney(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value);
}

function createEmptyGrid(): number[] {
  return new Array(GRID_SIZE * GRID_SIZE).fill(0);
}

function collapseGrid(grid: number[]): number[] {
  const safeTiles: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0) safeTiles.push(i);
  }
  if (safeTiles.length === 0) return [...grid];

  const toCollapse = Math.max(1, Math.floor(safeTiles.length * COLLAPSE_PERCENT));
  const shuffled = safeTiles.sort(() => Math.random() - 0.5);
  const next = [...grid];
  const limit = Math.min(toCollapse, shuffled.length);
  for (let i = 0; i < limit; i++) {
    next[shuffled[i]] = 1;
  }
  return next;
}

function findSpawnPosition(grid: number[], existingPlayers: GamePlayer[]): { x: number; y: number } {
  const occupied = new Set(existingPlayers.map(p => `${p.x},${p.y}`));
  const corners = [
    { x: 0, y: 0 },
    { x: GRID_SIZE - 1, y: 0 },
    { x: 0, y: GRID_SIZE - 1 },
    { x: GRID_SIZE - 1, y: GRID_SIZE - 1 },
  ];
  for (const c of corners) {
    if (grid[c.y * GRID_SIZE + c.x] === 0 && !occupied.has(`${c.x},${c.y}`)) return c;
  }
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y * GRID_SIZE + x] === 0 && !occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

// ─── Route Registration ───────────────────────────────────────────────────────

export default async function gameRoutes(app: FastifyInstance): Promise<void> {
  const USDC_MINT = process.env.USDC_MINT!;

  // ── POST /games ───────────────────────────────────────────────────────────
  app.post<{ Body: { buy_in_usdc?: string; max_players?: number } }>(
    '/games',
    {
      schema: {
        description: 'Create a new game lobby.',
        tags: ['Games'],
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          properties: {
            buy_in_usdc: { type: 'string' },
            max_players: { type: 'number' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { buy_in_usdc?: string; max_players?: number } }>,
      reply: FastifyReply,
    ) => {
      const buyIn = request.body?.buy_in_usdc ?? '0.50';
      const maxPlayers = request.body?.max_players ?? 4;

      if (!isValidMoney(buyIn) || parseFloat(buyIn) <= 0) {
        return reply.code(400).send(spliceError(
          'INVALID_BUY_IN',
          400,
          'buy_in_usdc must be a positive decimal string with up to 2 decimal places.',
          'Use a value like "0.50".',
        ));
      }

      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 16) {
        return reply.code(400).send(spliceError(
          'INVALID_MAX_PLAYERS',
          400,
          'max_players must be an integer between 2 and 16.',
          'Use a value like 4.',
        ));
      }

      const gameId = crypto.randomUUID();
      const pdaAddress = `pda_${crypto.randomBytes(16).toString('hex')}`;
      const escrowAddress = `escrow_${crypto.randomBytes(16).toString('hex')}`;

      const game: GameRecord = {
        game_id: gameId,
        pda_address: pdaAddress,
        escrow_address: escrowAddress,
        buy_in_usdc: buyIn,
        max_players: maxPlayers,
        status: 'waiting',
        grid_size: GRID_SIZE,
        grid: createEmptyGrid(),
        players: [],
        prize_pool_usdc: '0.00',
        collapse_round: 0,
        move_count: 0,
        winner: null,
        stripe_payout_initiated: false,
        created_at: Date.now(),
      };

      await saveGame(game);

      const response = {
        game_id: game.game_id,
        pda_address: game.pda_address,
        escrow_address: game.escrow_address,
        buy_in_usdc: game.buy_in_usdc,
        max_players: game.max_players,
        status: game.status,
      };
      return reply.code(201).send(response);
    },
  );

  // ── GET /games/:id ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/games/:id',
    {
      schema: {
        description: 'Get full game state.',
        tags: ['Games'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const game = await getGame(request.params.id);
      if (!game) {
        return reply.code(404).send(spliceError(
          'GAME_NOT_FOUND', 404,
          `Game ${request.params.id} not found.`,
          'Create a game first via POST /v1/games.',
        ));
      }

      return reply.send({
        game_id: game.game_id,
        status: game.status,
        grid_size: game.grid_size,
        grid: game.grid,
        players: game.players.map(p => ({
          pubkey: p.pubkey,
          x: p.x,
          y: p.y,
          alive: p.alive,
        })),
        buy_in_usdc: game.buy_in_usdc,
        max_players: game.max_players,
        prize_pool_usdc: game.prize_pool_usdc,
        collapse_round: game.collapse_round,
        winner: game.winner,
        stripe_payout_initiated: game.stripe_payout_initiated,
      });
    },
  );

  // ── POST /games/:id/join ──────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { player_id: string } }>(
    '/games/:id/join',
    {
      schema: {
        description: 'Join a game lobby. Requires Idempotency-Key header.',
        tags: ['Games'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { player_id: { type: 'string' } },
          required: ['player_id'],
        },
      },
    },
    withIdempotency(async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const { id } = request.params as { id: string };
      const { player_id } = request.body as { player_id: string };

      const game = await getGame(id);
      if (!game) {
        return reply.code(404).send(spliceError(
          'GAME_NOT_FOUND', 404,
          `Game ${id} not found.`,
          'Create a game first via POST /v1/games.',
        ));
      }

      if (game.status !== 'waiting') {
        return reply.code(409).send(spliceError(
          'GAME_NOT_JOINABLE', 409,
          `Game is ${game.status} and no longer accepting players.`,
          'Create or find a game with status "waiting".',
        ));
      }

      if (game.players.length >= game.max_players) {
        return reply.code(409).send(spliceError(
          'GAME_FULL', 409,
          `Game already has ${game.max_players} players.`,
          'Create or find a game with open slots.',
        ));
      }

      if (game.players.some(p => p.player_id === player_id)) {
        return reply.code(409).send(spliceError(
          'GAME_NOT_JOINABLE', 409,
          'Player has already joined this game.',
          'Use a different player or game.',
        ));
      }

      const player = await getPlayer(player_id);
      if (!player) {
        return reply.code(404).send(spliceError(
          'PLAYER_NOT_FOUND', 404,
          `Player ${player_id} not found.`,
          'Create a player first via POST /v1/players.',
        ));
      }

      const balance = await getTokenBalance(player.public_key, USDC_MINT);
      const buyIn = parseFloat(game.buy_in_usdc);
      if (balance < buyIn) {
        return reply.code(402).send(spliceError(
          'INSUFFICIENT_FUNDS', 402,
          `Player has ${balance} USDC but buy-in is ${game.buy_in_usdc}.`,
          'Fund the player via POST /v1/players/:id/checkout-session.',
        ));
      }

      const spawn = findSpawnPosition(game.grid, game.players);
      const gp: GamePlayer = {
        player_id,
        pubkey: player.public_key,
        x: spawn.x,
        y: spawn.y,
        alive: true,
      };
      game.players.push(gp);

      const currentPool = parseFloat(game.prize_pool_usdc);
      game.prize_pool_usdc = (currentPool + buyIn).toFixed(2);

      if (game.players.length >= 2) {
        game.status = 'active';
      }

      await saveGame(game);

      const response = {
        game_id: game.game_id,
        player_id,
        start_x: spawn.x,
        start_y: spawn.y,
        status: game.status,
      };
      return reply.code(200).send(response);
    }),
  );

  // ── POST /games/:id/move ──────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { player_id: string; direction: string } }>(
    '/games/:id/move',
    {
      schema: {
        description: 'Move a player on the grid. Requires Idempotency-Key header.',
        tags: ['Games'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            player_id: { type: 'string' },
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          },
          required: ['player_id', 'direction'],
        },
      },
    },
    withIdempotency(async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const { id } = request.params as { id: string };
      const { player_id, direction } = request.body as { player_id: string; direction: string };

      const game = await getGame(id);
      if (!game) {
        return reply.code(404).send(spliceError(
          'GAME_NOT_FOUND', 404,
          `Game ${id} not found.`,
          'Check the game ID.',
        ));
      }

      if (game.status !== 'active') {
        return reply.code(409).send(spliceError(
          'GAME_NOT_ACTIVE', 409,
          `Game is ${game.status}.`,
          game.status === 'waiting' ? 'Wait for enough players to join.' : 'Game is already resolved.',
        ));
      }

      const gp = game.players.find(p => p.player_id === player_id);
      if (!gp) {
        return reply.code(404).send(spliceError(
          'PLAYER_NOT_FOUND', 404,
          'Player is not in this game.',
          'Join the game first via POST /v1/games/:id/join.',
        ));
      }

      if (!gp.alive) {
        return reply.code(409).send(spliceError(
          'PLAYER_ELIMINATED', 409,
          'Player has been eliminated.',
          'Wait for the next game.',
        ));
      }

      let newX = gp.x;
      let newY = gp.y;
      switch (direction) {
        case 'up':    newY -= 1; break;
        case 'down':  newY += 1; break;
        case 'left':  newX -= 1; break;
        case 'right': newX += 1; break;
        default:
          return reply.code(400).send(spliceError(
            'OUT_OF_BOUNDS', 400,
            `Invalid direction "${direction}".`,
            'Use one of: up, down, left, right.',
          ));
      }

      if (newX < 0 || newX >= GRID_SIZE || newY < 0 || newY >= GRID_SIZE) {
        return reply.code(400).send(spliceError(
          'OUT_OF_BOUNDS', 400,
          `Move would go off the grid (${newX}, ${newY}).`,
          'Choose a direction that stays within the grid.',
        ));
      }

      const tileIdx = newY * GRID_SIZE + newX;
      if (game.grid[tileIdx] === 1) {
        return reply.code(409).send(spliceError(
          'TILE_IS_LAVA', 409,
          `Tile (${newX}, ${newY}) is lava.`,
          'Choose a different direction.',
        ));
      }

      gp.x = newX;
      gp.y = newY;
      game.move_count += 1;

      if (game.move_count % MOVES_PER_COLLAPSE === 0) {
        game.grid = collapseGrid(game.grid);
        game.collapse_round += 1;

        for (const p of game.players) {
          if (p.alive && game.grid[p.y * GRID_SIZE + p.x] === 1) {
            p.alive = false;
          }
        }
      }

      const alive = game.players.filter(p => p.alive);
      if (alive.length <= 1 && game.players.length >= 2) {
        game.status = 'resolved';
        game.winner = alive.length === 1 ? alive[0].player_id : null;
      }

      await saveGame(game);

      const response = {
        game_id: game.game_id,
        player_id,
        new_x: gp.x,
        new_y: gp.y,
        alive: gp.alive,
        status: game.status,
        winner: game.winner,
        grid_snapshot: game.grid,
        collapse_round: game.collapse_round,
      };
      return reply.code(200).send(response);
    }),
  );
}
