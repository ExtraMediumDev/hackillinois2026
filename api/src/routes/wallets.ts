import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateKeypair, createPlayerRecord, ensurePlayerLifecycleFields, markPlayerActive, markPlayerInactive } from '../services/wallet';
import { savePlayer, getPlayer, getAllPlayerIds, deletePlayer } from '../services/redis';
import { createCheckoutSession, createConnectAccount, createConnectOnboardingLink } from '../services/stripe';
import { getSolBalance, getTokenBalance, getTransactionHistory } from '../services/solana';
import { withIdempotency } from '../services/idempotency';
import { SpliceError } from '../types';

function spliceError(code: string, statusCode: number, message: string, remediation: string): SpliceError {
  return { status: 'error', statusCode, error: { code, message, remediation } };
}

export default async function walletRoutes(app: FastifyInstance): Promise<void> {
  const GRACE_HOURS_DEFAULT = parseInt(process.env.PLAYER_INACTIVE_GRACE_HOURS ?? '168', 10);
  const ZERO_USDC_EPSILON = 0.000001;
  const ZERO_SOL_EPSILON = 0.00001;

  const normalizeAndPersistIfNeeded = async (player: ReturnType<typeof ensurePlayerLifecycleFields>): Promise<typeof player> => {
    const normalized = ensurePlayerLifecycleFields(player);
    if (
      normalized.wallet_state !== player.wallet_state
      || normalized.last_active_at !== player.last_active_at
    ) {
      await savePlayer(normalized);
    }
    return normalized;
  };

  // ── POST /wallets ─── Create wallet ─────────────────────────────────────────
  app.post(
    '/wallets',
    {
      schema: {
        description: 'Create a new wallet.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        response: {
          201: {
            type: 'object',
            properties: {
              wallet_id: { type: 'string' },
              public_key: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const keypair = generateKeypair();
      const player = createPlayerRecord(keypair);
      await savePlayer(player);

      return reply.code(201).send({
        wallet_id: player.player_id,
        public_key: player.public_key,
      });
    },
  );

  // ── GET /wallets/:id ─── Get wallet balance ────────────────────────────────
  app.get(
    '/wallets/:id',
    {
      schema: {
        description: 'Get wallet balance.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              wallet_id: { type: 'string' },
              public_key: { type: 'string' },
              sol_balance: { type: 'number' },
              usdc_balance: { type: 'number' },
              on_chain_usdc: { type: 'number' },
              simulated_usdc: { type: 'number' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const existing = await getPlayer(request.params.id);
      if (!existing) {
        return reply.code(404).send(spliceError(
          'WALLET_NOT_FOUND', 404,
          `Wallet ${request.params.id} not found.`,
          'Create a wallet first via POST /v1/wallets.',
        ));
      }

      const player = await normalizeAndPersistIfNeeded(existing);
      const usdcMint = process.env.USDC_MINT!;
      const [solBalance, usdcBalance] = await Promise.all([
        getSolBalance(player.public_key),
        getTokenBalance(player.public_key, usdcMint),
      ]);
      const simulatedBalance = player.simulated_usdc_balance ?? 0;

      return reply.send({
        wallet_id: player.player_id,
        public_key: player.public_key,
        sol_balance: solBalance,
        usdc_balance: usdcBalance + simulatedBalance,
        on_chain_usdc: usdcBalance,
        simulated_usdc: simulatedBalance,
      });
    },
  );

  // ── POST /wallets/:id/deposit ─── Fund via Stripe ──────────────────────────
  app.post(
    '/wallets/:id/deposit',
    {
      schema: {
        description: 'Fund wallet via Stripe Checkout.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            success_url: { type: 'string' },
            cancel_url: { type: 'string' },
            amount_usd: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              amount_usd: { type: 'number' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { success_url?: string; cancel_url?: string; amount_usd?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const existing = await getPlayer(request.params.id);
      if (!existing) {
        return reply.code(404).send(spliceError(
          'WALLET_NOT_FOUND', 404,
          `Wallet ${request.params.id} not found.`,
          'Create a wallet first via POST /v1/wallets.',
        ));
      }
      const player = await normalizeAndPersistIfNeeded(existing);
      const successUrl = request.body?.success_url ?? 'http://localhost:3000/success';
      const cancelUrl = request.body?.cancel_url ?? 'http://localhost:3000/cancel';
      const amountUsd = request.body?.amount_usd ?? 0.5;
      const amountCents = Math.round(amountUsd * 100);

      if (amountCents < 50) {
        return reply.code(400).send(spliceError(
          'INVALID_AMOUNT', 400,
          'Stripe minimum is $0.50. Use amount_usd >= 0.5.',
          'Omit amount_usd for default $0.50.',
        ));
      }

      try {
        const url = await createCheckoutSession({
          playerId: player.player_id,
          amountCents,
          successUrl,
          cancelUrl,
        });
        await savePlayer(markPlayerActive(player));
        return reply.send({ url, amount_usd: amountUsd });
      } catch (err) {
        app.log.error({ err }, 'Checkout session create failed');
        return reply.code(500).send(spliceError(
          'CHECKOUT_ERROR', 500,
          'Failed to create payment session.',
          'Check Stripe configuration.',
        ));
      }
    },
  );

  // ── POST /wallets/:id/withdraw ─── Cash out ───────────────────────────────
  app.post(
    '/wallets/:id/withdraw',
    {
      schema: {
        description: 'Withdraw from wallet balance.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            amount_usdc: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              wallet_id: { type: 'string' },
              public_key: { type: 'string' },
              amount_usdc: { type: 'number' },
              remaining_balance: { type: 'number' },
              confirmation_id: { type: 'string' },
              settlement_mode: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { amount_usdc?: number } }>,
      reply: FastifyReply,
    ) => {
      const existing = await getPlayer(request.params.id);
      if (!existing) {
        return reply.code(404).send(spliceError(
          'WALLET_NOT_FOUND', 404, 'Wallet not found.', 'Create a wallet first via POST /v1/wallets.',
        ));
      }
      const player = await normalizeAndPersistIfNeeded(existing);
      const simulatedBal = player.simulated_usdc_balance ?? 0;
      const requestedAmount = request.body?.amount_usdc;
      const amount = requestedAmount !== undefined ? requestedAmount : simulatedBal;

      if (amount <= 0) {
        return reply.code(400).send(spliceError(
          'INVALID_AMOUNT', 400, 'Nothing to withdraw.', 'Balance must be positive.',
        ));
      }
      if (amount > simulatedBal) {
        return reply.code(400).send(spliceError(
          'INSUFFICIENT_BALANCE', 400,
          `Requested ${amount} but balance is ${simulatedBal.toFixed(2)}.`,
          'Request a smaller amount or omit amount_usdc to withdraw the full balance.',
        ));
      }

      player.simulated_usdc_balance = simulatedBal - amount;
      await savePlayer(player);

      return reply.send({
        status: 'settled',
        wallet_id: player.player_id,
        public_key: player.public_key,
        amount_usdc: amount,
        remaining_balance: player.simulated_usdc_balance,
        confirmation_id: `withdraw_${player.player_id.slice(0, 8)}_${Date.now()}`,
        settlement_mode: 'simulated',
      });
    },
  );

  // ── POST /wallets/:id/transfer ─── Credit or debit balance ─────────────────
  app.post(
    '/wallets/:id/transfer',
    {
      schema: {
        description: 'Credit or debit a wallet. Positive amount = credit, negative = debit.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            amount_usdc: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['amount_usdc'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              wallet_id: { type: 'string' },
              before_balance: { type: 'number' },
              after_balance: { type: 'number' },
              amount_usdc: { type: 'number' },
              note: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    withIdempotency(async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const { id } = request.params as { id: string };
      const { amount_usdc, note } = request.body as { amount_usdc: string; note?: string };

      const amount = parseFloat(amount_usdc);
      if (isNaN(amount) || amount === 0) {
        return reply.code(400).send(spliceError(
          'INVALID_AMOUNT', 400,
          'amount_usdc must be a non-zero number.',
          'Provide a positive value to credit or negative value to debit.',
        ));
      }

      const existing = await getPlayer(id);
      if (!existing) {
        return reply.code(404).send(spliceError(
          'WALLET_NOT_FOUND', 404,
          `Wallet ${id} not found.`,
          'Create a wallet first via POST /v1/wallets.',
        ));
      }
      const player = await normalizeAndPersistIfNeeded(existing);

      const before = player.simulated_usdc_balance ?? 0;
      let after = before + amount;
      if (after < 0) after = 0;
      player.simulated_usdc_balance = after;
      await savePlayer(player);

      return reply.send({
        wallet_id: player.player_id,
        before_balance: before,
        after_balance: after,
        amount_usdc: amount,
        note: note ?? null,
      });
    }),
  );

  // ── GET /wallets/:id/transactions ─── On-chain history ─────────────────────
  app.get(
    '/wallets/:id/transactions',
    {
      schema: {
        description: 'On-chain transaction history.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              wallet_id: { type: 'string' },
              public_key: { type: 'string' },
              transactions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    signature: { type: 'string' },
                    blockTime: { type: ['number', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply,
    ) => {
      const existing = await getPlayer(request.params.id);
      if (!existing) {
        return reply.code(404).send(spliceError(
          'WALLET_NOT_FOUND', 404, 'Wallet not found.', 'Create a wallet first.',
        ));
      }
      const player = await normalizeAndPersistIfNeeded(existing);
      await savePlayer(markPlayerActive(player));
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
      const transactions = await getTransactionHistory(player.public_key, limit);

      return reply.send({
        wallet_id: player.player_id,
        public_key: player.public_key,
        transactions,
      });
    },
  );

  // ── POST /wallets/:id/connect ─── Stripe Connect onboarding ───────────────
  app.post(
    '/wallets/:id/connect',
    {
      schema: {
        description: 'Create a Stripe Connect account for fiat payouts.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: { url: { type: 'string' } },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const existing = await getPlayer(request.params.id);
      if (!existing) {
        return reply.code(404).send(spliceError(
          'WALLET_NOT_FOUND', 404, 'Wallet not found.', 'Create a wallet first.',
        ));
      }
      const player = await normalizeAndPersistIfNeeded(existing);

      let accountId = player.stripe_connect_account_id;
      if (!accountId) {
        accountId = await createConnectAccount();
        player.stripe_connect_account_id = accountId;
      }
      await savePlayer(markPlayerActive(player));

      const url = await createConnectOnboardingLink(
        accountId,
        'http://localhost:3000/connect/refresh',
        'http://localhost:3000/connect/return',
      );

      return reply.send({ url });
    },
  );

  // ── POST /wallets/cleanup-inactive ─── Housekeeping ───────────────────────
  app.post(
    '/wallets/cleanup-inactive',
    {
      schema: {
        description: 'Delete inactive wallets after grace period if balances are zero.',
        tags: ['Wallets'],
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          properties: {
            dry_run: { type: 'boolean' },
            grace_hours: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              dry_run: { type: 'boolean' },
              grace_hours: { type: 'number' },
              scanned: { type: 'number' },
              eligible_count: { type: 'number' },
              deleted_count: { type: 'number' },
              eligible_wallet_ids: { type: 'array', items: { type: 'string' } },
              skipped: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    wallet_id: { type: 'string' },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { dry_run?: boolean; grace_hours?: number } }>,
      reply: FastifyReply,
    ) => {
      const now = Date.now();
      const graceHours = request.body?.grace_hours ?? GRACE_HOURS_DEFAULT;
      const dryRun = request.body?.dry_run ?? true;
      const graceMs = Math.max(1, graceHours) * 60 * 60 * 1000;

      const playerIds = await getAllPlayerIds();
      const eligibleForDeletion: string[] = [];
      const skipped: Array<{ wallet_id: string; reason: string }> = [];

      for (const playerId of playerIds) {
        const raw = await getPlayer(playerId);
        if (!raw) continue;
        const player = ensurePlayerLifecycleFields(raw);
        if (player.wallet_state !== 'inactive') continue;
        if (!player.inactive_since) {
          skipped.push({ wallet_id: playerId, reason: 'inactive_since missing' });
          continue;
        }
        if (now - player.inactive_since < graceMs) {
          skipped.push({ wallet_id: playerId, reason: 'within grace period' });
          continue;
        }
        if (player.pending_payout || player.pending_onchain_settlement) {
          skipped.push({ wallet_id: playerId, reason: 'pending operations' });
          continue;
        }

        const [usdcBalance, solBalance] = await Promise.all([
          getTokenBalance(player.public_key, process.env.USDC_MINT!),
          getSolBalance(player.public_key),
        ]);
        if (usdcBalance > ZERO_USDC_EPSILON || solBalance > ZERO_SOL_EPSILON) {
          skipped.push({ wallet_id: playerId, reason: 'non-zero balance' });
          continue;
        }

        eligibleForDeletion.push(playerId);
      }

      if (!dryRun) {
        for (const playerId of eligibleForDeletion) {
          await deletePlayer(playerId);
        }
      }

      return reply.send({
        dry_run: dryRun,
        grace_hours: graceHours,
        scanned: playerIds.length,
        eligible_count: eligibleForDeletion.length,
        deleted_count: dryRun ? 0 : eligibleForDeletion.length,
        eligible_wallet_ids: eligibleForDeletion,
        skipped,
      });
    },
  );
}
