import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateKeypair, createPlayerRecord, ensurePlayerLifecycleFields, markPlayerActive, markPlayerInactive } from '../services/wallet';
import { savePlayer, getPlayer, getAllPlayerIds, deletePlayer } from '../services/redis';
import { createOnrampSession, createCheckoutSession, createConnectAccount, createConnectOnboardingLink, createTransferToConnectedAccount, initiateInstantPayout } from '../services/stripe';
import { getSolBalance, getTokenBalance, getTransactionHistory, transferUsdcFromPlayer } from '../services/solana';
import { decryptKeypair } from '../services/wallet';

export default async function playerRoutes(app: FastifyInstance): Promise<void> {
  const GRACE_HOURS_DEFAULT = parseInt(process.env.PLAYER_INACTIVE_GRACE_HOURS ?? '168', 10);
  const ZERO_USDC_EPSILON = 0.000001;
  const ZERO_SOL_EPSILON = 0.00001;
  const DEMO_PAYOUT_DESTINATION = process.env.DEMO_PAYOUT_DESTINATION_CONNECT_ACCOUNT_ID;
  const DEMO_PAYOUT_MODE = process.env.DEMO_PAYOUT_MODE === 'true' || Boolean(DEMO_PAYOUT_DESTINATION);
  const DEMO_PAYOUT_SIMULATE = process.env.DEMO_PAYOUT_SIMULATE !== 'false';

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

  /**
   * POST /v1/players
   * Creates a new burner wallet and returns a Stripe Onramp link.
   */
  app.post(
    '/players',
    {
      schema: {
        description: 'Creates a new burner wallet and returns a Stripe Onramp link.',
        tags: ['Players'],
        security: [{ apiKey: [] }],
        response: {
          201: {
            type: 'object',
            properties: {
              player_id: { type: 'string' },
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

      const response = {
        player_id: player.player_id,
        public_key: player.public_key,
      };
      return reply.code(201).send(response);
    });

  /**
   * POST /v1/players/:id/checkout-session
   * Creates a Stripe Checkout session for demo payments. On success, webhook credits devnet USDC to this player.
   * Body: { success_url, cancel_url, amount_usd? } — amount_usd defaults to 0.05
   */
  app.post<{
    Params: { id: string };
    Body: { success_url?: string; cancel_url?: string; amount_usd?: number };
  }>(
    '/players/:id/checkout-session',
    {
      schema: {
        description: 'Creates a Stripe Checkout session for demo payments. On success, webhook credits devnet USDC to this player.',
        tags: ['Players'],
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
      reply: FastifyReply
    ) => {
      const existingPlayer = await getPlayer(request.params.id);
      if (!existingPlayer) {
        return reply.code(404).send({
          status: 'error',
          statusCode: 404,
          error: {
            code: 'PLAYER_NOT_FOUND',
            message: `Player ${request.params.id} not found.`,
            remediation: 'Create a player first via POST /v1/players.',
          },
        });
      }
      const player = await normalizeAndPersistIfNeeded(existingPlayer);
      const successUrl = request.body?.success_url ?? 'http://localhost:3000/success';
      const cancelUrl = request.body?.cancel_url ?? 'http://localhost:3000/cancel';
      const amountUsd = request.body?.amount_usd ?? 0.5;
      const amountCents = Math.round(amountUsd * 100);
      if (amountCents < 50) {
        return reply.code(400).send({
          status: 'error',
          statusCode: 400,
          error: {
            code: 'INVALID_AMOUNT',
            message: 'Stripe minimum is $0.50. Use amount_usd >= 0.5.',
            remediation: 'Omit amount_usd for default $0.50.',
          },
        });
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
        return reply.code(500).send({
          status: 'error',
          statusCode: 500,
          error: {
            code: 'CHECKOUT_ERROR',
            message: 'Failed to create payment session.',
            remediation: 'Check Stripe configuration.',
          },
        });
      }
    }
  );

  /**
   * GET /v1/players/:id
   * Returns player info with live on-chain balances.
   */
  app.get<{ Params: { id: string } }>(
    '/players/:id',
    {
      schema: {
        description: 'Returns player info with live on-chain balances.',
        tags: ['Players'],
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
              player_id: { type: 'string' },
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
      reply: FastifyReply
    ) => {
      const existingPlayer = await getPlayer(request.params.id);
      if (!existingPlayer) {
        return reply.code(404).send({
          status: 'error',
          statusCode: 404,
          error: {
            code: 'PLAYER_NOT_FOUND',
            message: `Player ${request.params.id} not found.`,
            remediation: 'Create a player first via POST /v1/players.',
          },
        });
      }

      const player = await normalizeAndPersistIfNeeded(existingPlayer);
      const usdcMint = process.env.USDC_MINT!;
      const [solBalance, usdcBalance] = await Promise.all([
        getSolBalance(player.public_key),
        getTokenBalance(player.public_key, usdcMint),
      ]);

      const simulatedBalance = player.simulated_usdc_balance ?? 0;

      return reply.send({
        player_id: player.player_id,
        public_key: player.public_key,
        sol_balance: solBalance,
        usdc_balance: usdcBalance + simulatedBalance,
        on_chain_usdc: usdcBalance,
        simulated_usdc: simulatedBalance,
      });
    }
  );

  /**
   * GET /v1/players/:id/transactions
   * Returns paginated transaction history for the player's burner wallet.
   */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/players/:id/transactions',
    {
      schema: {
        description: "Returns paginated transaction history for the player's burner wallet.",
        tags: ['Players'],
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
              player_id: { type: 'string' },
              public_key: { type: 'string' },
              transactions: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const existingPlayer = await getPlayer(request.params.id);
      if (!existingPlayer) {
        return reply.code(404).send({
          status: 'error',
          statusCode: 404,
          error: {
            code: 'PLAYER_NOT_FOUND',
            message: `Player ${request.params.id} not found.`,
            remediation: 'Create a player first via POST /v1/players.',
          },
        });
      }

      const player = await normalizeAndPersistIfNeeded(existingPlayer);
      await savePlayer(markPlayerActive(player));
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
      const transactions = await getTransactionHistory(player.public_key, limit);

      return reply.send({
        player_id: player.player_id,
        public_key: player.public_key,
        transactions,
      });
    }
  );

  /**
   * POST /v1/players/:id/connect
   * Creates or retrieves a Stripe Connect account for the player and returns an onboarding link.
   */
  app.post<{ Params: { id: string } }>(
    '/players/:id/connect',
    {
      schema: {
        description: 'Creates a Stripe Connect account for the player and returns an onboarding link so they can receive fiat payouts.',
        tags: ['Players'],
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
              url: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const existingPlayer = await getPlayer(request.params.id);
      if (!existingPlayer) {
        return reply.code(404).send({ status: 'error', statusCode: 404, error: { code: 'Not Found', message: 'Player not found', remediation: '' } });
      }
      const player = await normalizeAndPersistIfNeeded(existingPlayer);

      let accountId = player.stripe_connect_account_id;
      if (!accountId) {
        accountId = await createConnectAccount();
        player.stripe_connect_account_id = accountId;
      }
      await savePlayer(markPlayerActive(player));

      // Generate the secure URL where the user inputs their bank details
      const url = await createConnectOnboardingLink(
        accountId,
        'http://localhost:3000/connect/refresh',
        'http://localhost:3000/connect/return'
      );

      return reply.send({ url });
    }
  );

  /**
   * POST /v1/players/:id/cashout
   * Offramps the player's USDC to fiat via their connected Stripe account.
   */
  app.post<{ Params: { id: string }; Body: { amount_usdc?: number } }>(
    '/players/:id/cashout',
    {
      schema: {
        description: 'Offramps USDC from the burner wallet to the user\'s connected Stripe bank account.',
        tags: ['Players'],
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
              solana_signature: { type: 'string' },
              stripe_payout_id: { type: 'string' },
              amount_transferred: { type: 'number' },
              settlement_mode: { type: 'string' },
              fiat_payout_status: { type: 'string' },
              payout_destination_connect_account_id: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { amount_usdc?: number } }>,
      reply: FastifyReply
    ) => {
      const existingPlayer = await getPlayer(request.params.id);
      if (!existingPlayer) {
        return reply.code(404).send({ status: 'error', statusCode: 404, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found.', remediation: '' } });
      }
      const player = await normalizeAndPersistIfNeeded(existingPlayer);

      const simulatedBal = player.simulated_usdc_balance ?? 0;
      const requestedAmount = request.body?.amount_usdc;

      // Simulated cashout: deduct from simulated_usdc_balance (game winnings).
      // No on-chain transfer or Stripe Connect needed.
      if (simulatedBal > 0 && (requestedAmount === undefined || requestedAmount <= simulatedBal)) {
        const amount = requestedAmount !== undefined ? requestedAmount : simulatedBal;
        if (amount <= 0) {
          return reply.code(400).send({ status: 'error', statusCode: 400, error: { code: 'INVALID', message: 'Cannot transfer 0.', remediation: '' } });
        }
        player.simulated_usdc_balance = simulatedBal - amount;
        await savePlayer(player);

        return reply.send({
          status: 'settled',
          solana_signature: 'simulated_cashout',
          stripe_payout_id: `simulated_cashout_${player.player_id.slice(0, 8)}_${Date.now()}`,
          amount_transferred: amount,
          settlement_mode: 'simulated',
          fiat_payout_status: 'simulated_success',
          payout_destination_connect_account_id: 'simulated',
        });
      }

      if (DEMO_PAYOUT_MODE && !DEMO_PAYOUT_DESTINATION) {
        return reply.code(500).send({
          status: 'error',
          statusCode: 500,
          error: {
            code: 'DEMO_PAYOUT_CONFIG_MISSING',
            message: 'Demo payout mode is enabled but DEMO_PAYOUT_DESTINATION_CONNECT_ACCOUNT_ID is missing.',
            remediation: 'Set a preconfigured Stripe connected account ID in env.',
          },
        });
      }

      if (!DEMO_PAYOUT_MODE && !player.stripe_connect_account_id) {
        return reply.code(400).send({
          status: 'error',
          statusCode: 400,
          error: {
            code: 'CONNECT_ACCOUNT_MISSING',
            message: 'You have not linked a bank account.',
            remediation: 'Call POST /v1/players/:id/connect to set up payouts before cashing out.',
          },
        });
      }

      const usdcMint = process.env.USDC_MINT!;
      const currentUsdcBalance = await getTokenBalance(player.public_key, usdcMint);

      const amountToTransfer = requestedAmount !== undefined ? requestedAmount : currentUsdcBalance;

      if (amountToTransfer <= 0) {
        return reply.code(400).send({ status: 'error', statusCode: 400, error: { code: 'INVALID', message: 'Cannot transfer 0.', remediation: '' } });
      }
      if (currentUsdcBalance < amountToTransfer) {
        return reply.code(400).send({ status: 'error', statusCode: 400, error: { code: 'INSUFFICIENT', message: 'Not enough balance.', remediation: '' } });
      }

      player.pending_payout = true;
      player.pending_onchain_settlement = true;
      await savePlayer(markPlayerActive(player));

      const keypair = decryptKeypair(player.encrypted_keypair);

      // Step 1: Transfer USDC from Burner Wallet -> API Master Treasury
      // We read the authority public key from our own Keypair config
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const keyPath = process.env.AUTHORITY_KEYPAIR_PATH!.startsWith('~')
        ? path.join(os.homedir(), process.env.AUTHORITY_KEYPAIR_PATH!.slice(1))
        : path.resolve(process.env.AUTHORITY_KEYPAIR_PATH!);
      const raw = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
      const authorityKeypair = require('@solana/web3.js').Keypair.fromSecretKey(Uint8Array.from(raw));
      const treasuryAddress = authorityKeypair.publicKey.toBase58();

      let solanaSignature;
      try {
        solanaSignature = await transferUsdcFromPlayer(
          keypair,
          treasuryAddress,
          amountToTransfer
        );
      } catch (err) {
        player.pending_onchain_settlement = false;
        player.pending_payout = false;
        await savePlayer(player);
        app.log.error({ err, playerId: player.player_id }, 'Web3 Cashout Failed');
        return reply.code(500).send({ status: 'error', statusCode: 500, error: { code: 'CASHOUT_FAILED_WEB3', message: 'Failed to move funds on-chain.', remediation: '' } });
      }
      player.pending_onchain_settlement = false;

      // Step 2: Trigger fiat settlement.
      // In demo mode we can simulate this step to avoid flaky Stripe test-balance constraints.
      let settlementMode: 'simulated' | 'stripe' = 'stripe';
      let fiatPayoutStatus: 'simulated_success' | 'stripe_success' | 'stripe_failed' = 'stripe_success';
      let stripePayoutId = DEMO_PAYOUT_MODE ? 'simulated_payout_demo' : 'simulated_payout_dev';
      if (DEMO_PAYOUT_MODE && DEMO_PAYOUT_SIMULATE) {
        settlementMode = 'simulated';
        fiatPayoutStatus = 'simulated_success';
        stripePayoutId = `simulated_demo_${player.player_id.slice(0, 8)}_${Date.now()}`;
        app.log.info(
          { playerId: player.player_id, destination: DEMO_PAYOUT_DESTINATION, amount: amountToTransfer },
          'Demo payout settlement simulated'
        );
      } else {
        try {
          const amountCents = Math.round(amountToTransfer * 100);
          if (DEMO_PAYOUT_MODE) {
            const transfer = await createTransferToConnectedAccount(DEMO_PAYOUT_DESTINATION!, amountCents);
            stripePayoutId = transfer.id;
          } else {
            const payout = await initiateInstantPayout(player.stripe_connect_account_id!, amountCents);
            stripePayoutId = payout.id;
          }
        } catch (err) {
          fiatPayoutStatus = 'stripe_failed';
          app.log.error({ err, playerId: player.player_id, demoPayout: DEMO_PAYOUT_MODE }, 'Stripe payout step failed');
          // If Stripe fails, the platform now holds the user's USDC. In production we'd refund or queue retry.
        }
      }
      player.pending_payout = false;

      // Move to inactive state only after explicit safety checks.
      const [postUsdc, postSol] = await Promise.all([
        getTokenBalance(player.public_key, usdcMint),
        getSolBalance(player.public_key),
      ]);
      if (postUsdc <= ZERO_USDC_EPSILON && postSol <= ZERO_SOL_EPSILON) {
        await savePlayer(markPlayerInactive(player));
      } else {
        await savePlayer(markPlayerActive(player));
      }

      return reply.send({
        status: 'success',
        solana_signature: solanaSignature,
        stripe_payout_id: stripePayoutId,
        amount_transferred: amountToTransfer,
        settlement_mode: settlementMode,
        fiat_payout_status: fiatPayoutStatus,
        payout_destination_connect_account_id: DEMO_PAYOUT_MODE ? DEMO_PAYOUT_DESTINATION : player.stripe_connect_account_id,
      });
    }
  );

  /**
   * POST /v1/players/cleanup-inactive
   * Removes inactive players after a grace period and only if balances are effectively zero.
   */
  app.post<{ Body: { dry_run?: boolean; grace_hours?: number } }>(
    '/players/cleanup-inactive',
    {
      schema: {
        description: 'Deletes inactive players after grace period if balances are effectively zero.',
        tags: ['Players'],
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          properties: {
            dry_run: { type: 'boolean' },
            grace_hours: { type: 'number' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { dry_run?: boolean; grace_hours?: number } }>,
      reply: FastifyReply
    ) => {
      const now = Date.now();
      const graceHours = request.body?.grace_hours ?? GRACE_HOURS_DEFAULT;
      const dryRun = request.body?.dry_run ?? true;
      const graceMs = Math.max(1, graceHours) * 60 * 60 * 1000;

      const playerIds = await getAllPlayerIds();
      const eligibleForDeletion: string[] = [];
      const skipped: Array<{ player_id: string; reason: string }> = [];

      for (const playerId of playerIds) {
        const raw = await getPlayer(playerId);
        if (!raw) continue;
        const player = ensurePlayerLifecycleFields(raw);
        if (player.wallet_state !== 'inactive') {
          continue;
        }
        if (!player.inactive_since) {
          skipped.push({ player_id: playerId, reason: 'inactive_since missing' });
          continue;
        }
        if (now - player.inactive_since < graceMs) {
          skipped.push({ player_id: playerId, reason: 'within grace period' });
          continue;
        }
        if (player.pending_payout || player.pending_onchain_settlement) {
          skipped.push({ player_id: playerId, reason: 'pending operations' });
          continue;
        }

        const [usdcBalance, solBalance] = await Promise.all([
          getTokenBalance(player.public_key, process.env.USDC_MINT!),
          getSolBalance(player.public_key),
        ]);
        if (usdcBalance > ZERO_USDC_EPSILON || solBalance > ZERO_SOL_EPSILON) {
          skipped.push({ player_id: playerId, reason: 'non-zero balance' });
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
        eligible_player_ids: eligibleForDeletion,
        skipped,
      });
    }
  );
}
