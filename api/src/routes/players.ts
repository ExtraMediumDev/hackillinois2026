import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateKeypair, createPlayerRecord } from '../services/wallet';
import { savePlayer, getPlayer } from '../services/redis';
import { createOnrampSession } from '../services/stripe';
import { getSolBalance, getTokenBalance, getTransactionHistory } from '../services/solana';

export default async function playerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/players
   * Creates a new burner wallet and returns a Stripe Onramp link.
   */
  app.post('/players', async (_request: FastifyRequest, reply: FastifyReply) => {
    const keypair = generateKeypair();
    const player = createPlayerRecord(keypair);

    const onrampUrl = await createOnrampSession(player.public_key);
    await savePlayer(player);

    const response = {
      player_id: player.player_id,
      public_key: player.public_key,
      stripe_onramp_session_url: onrampUrl,
    };
    return reply.code(201).send(response);
  });

  /**
   * GET /v1/players/:id
   * Returns player info with live on-chain balances.
   */
  app.get(
    '/players/:id',
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
  app.get(
    '/players/:id/transactions',
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
}
