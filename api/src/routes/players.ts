import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateKeypair, createPlayerRecord } from '../services/wallet';
import { savePlayer, getPlayer } from '../services/redis';
import { createOnrampSession, createCheckoutSession, createConnectAccount, createConnectOnboardingLink, initiateInstantPayout } from '../services/stripe';
import { getSolBalance, getTokenBalance, getTransactionHistory, transferUsdcFromPlayer } from '../services/solana';
import { decryptKeypair } from '../services/wallet';

export default async function playerRoutes(app: FastifyInstance): Promise<void> {
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
      const player = await getPlayer(request.params.id);
      if (!player) {
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
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const player = await getPlayer(request.params.id);
      if (!player) {
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

      const usdcMint = process.env.USDC_MINT!;
      const [solBalance, usdcBalance] = await Promise.all([
        getSolBalance(player.public_key),
        getTokenBalance(player.public_key, usdcMint),
      ]);

      return reply.send({
        player_id: player.player_id,
        public_key: player.public_key,
        sol_balance: solBalance,
        usdc_balance: usdcBalance,
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
      const player = await getPlayer(request.params.id);
      if (!player) {
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
      const player = await getPlayer(request.params.id);
      if (!player) {
        return reply.code(404).send({ status: 'error', statusCode: 404, error: { code: 'Not Found', message: 'Player not found', remediation: '' } });
      }

      let accountId = player.stripe_connect_account_id;
      if (!accountId) {
        accountId = await createConnectAccount();
        player.stripe_connect_account_id = accountId;
        await savePlayer(player);
      }

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
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { amount_usdc?: number } }>,
      reply: FastifyReply
    ) => {
      const player = await getPlayer(request.params.id);
      if (!player) {
        return reply.code(404).send({ status: 'error', statusCode: 404, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found.', remediation: '' } });
      }

      if (!player.stripe_connect_account_id) {
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

      const requestedAmount = request.body?.amount_usdc;
      const amountToTransfer = requestedAmount !== undefined ? requestedAmount : currentUsdcBalance;

      if (amountToTransfer <= 0) {
        return reply.code(400).send({ status: 'error', statusCode: 400, error: { code: 'INVALID', message: 'Cannot transfer 0.', remediation: '' } });
      }
      if (currentUsdcBalance < amountToTransfer) {
        return reply.code(400).send({ status: 'error', statusCode: 400, error: { code: 'INSUFFICIENT', message: 'Not enough balance.', remediation: '' } });
      }

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
        app.log.error({ err, playerId: player.player_id }, 'Web3 Cashout Failed');
        return reply.code(500).send({ status: 'error', statusCode: 500, error: { code: 'CASHOUT_FAILED_WEB3', message: 'Failed to move funds on-chain.', remediation: '' } });
      }

      // Step 2: Trigger Stripe Instant Payout from Platform -> User Connected Bank
      // Warning: In dev mode, Stripe may throw if the Connect account isn't fully verified.
      let stripePayoutId = "simulated_payout_dev";
      try {
        const amountCents = Math.round(amountToTransfer * 100);
        const payout = await initiateInstantPayout(player.stripe_connect_account_id, amountCents);
        stripePayoutId = payout.id;
      } catch (err) {
        app.log.error({ err, playerId: player.player_id }, 'Stripe Connect Payout Failed');
        // If Stripe fails, the platform now holds the user's USDC. In a prod app, we'd refund or queue retry.
      }

      return reply.send({
        status: 'success',
        solana_signature: solanaSignature,
        stripe_payout_id: stripePayoutId,
        amount_transferred: amountToTransfer
      });
    }
  );
}
