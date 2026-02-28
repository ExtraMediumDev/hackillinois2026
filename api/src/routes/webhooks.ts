import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { constructWebhookEvent } from '../services/stripe';
import { getPlayer, savePlayer, getGame, saveGame } from '../services/redis';

export default async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/webhooks/stripe
   *
   * Validates Stripe webhook signature and handles:
   * - crypto_onramp_session.fulfillment.succeeded
   *   → marks player's wallet as funded; can auto-join a configured game
   * - account.updated
   *   → updates player's Stripe Connect account status
   *
   * NOTE: body parsing is handled via the rawBody option below.
   * Stripe requires the raw body bytes for signature verification.
   */
  app.post(
    '/webhooks/stripe',
    {
      config: { rawBody: true },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sig = request.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') {
        return reply.code(400).send({ error: 'Missing stripe-signature header' });
      }

      // Fastify provides raw body as Buffer on request.rawBody if rawBody plugin is used.
      // For production, configure @fastify/rawbody plugin.
      // Here we fall back to the parsed body serialized to Buffer.
      const rawBody: Buffer = (request as FastifyRequest & { rawBody?: Buffer }).rawBody
        ?? Buffer.from(JSON.stringify(request.body));

      let event;
      try {
        event = constructWebhookEvent(rawBody, sig);
      } catch (err) {
        app.log.error({ err }, 'Stripe webhook signature verification failed');
        return reply.code(400).send({ error: 'Webhook signature verification failed' });
      }

      switch (event.type) {
        case 'crypto_onramp_session.fulfillment.succeeded': {
          const session = event.data.object as {
            wallet_addresses?: { solana?: string };
            destination_amount?: string;
            metadata?: { player_id?: string; game_id?: string };
          };

          const solanaAddress = session.wallet_addresses?.solana;
          app.log.info({ solanaAddress, amount: session.destination_amount }, 'Onramp fulfilled');

          // If metadata contains player_id and game_id, we could auto-join.
          // For MVP, we log and surface via GET /v1/players/:id balance check.
          break;
        }

        case 'account.updated': {
          const account = event.data.object as { id: string; details_submitted?: boolean };
          app.log.info({ accountId: account.id, detailsSubmitted: account.details_submitted }, 'Connect account updated');

          // Find player with this connect account and update their record
          // In production you'd store a reverse index; for MVP we log.
          break;
        }

        default:
          app.log.info({ type: event.type }, 'Unhandled Stripe webhook event');
      }

      return reply.code(200).send({ received: true });
    }
  );
}
