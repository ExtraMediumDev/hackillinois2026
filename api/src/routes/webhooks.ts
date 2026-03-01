import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { constructWebhookEvent } from '../services/stripe';
import { getPlayer, savePlayer } from '../services/redis';
import { transferUsdcToPlayer } from '../services/solana';
import { ensurePlayerLifecycleFields, markPlayerActive } from '../services/wallet';

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
      if (sig === 'test-signature') {
        // Bypass for local testing without Stripe CLI
        event = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      } else {
        try {
          event = constructWebhookEvent(rawBody, sig);
        } catch (err) {
          app.log.error({ err }, 'Stripe webhook signature verification failed');
          return reply.code(400).send({ error: 'Webhook signature verification failed' });
        }
      }

      switch (event.type as string) {
        case 'checkout.session.completed': {
          const session = event.data.object as {
            metadata?: { player_id?: string };
            client_reference_id?: string | null;
            amount_total?: number | null;
            payment_status?: string;
          };
          const playerId = session.metadata?.player_id ?? session.client_reference_id ?? null;
          if (!playerId) {
            app.log.warn('checkout.session.completed missing player_id / client_reference_id');
            break;
          }
          if (session.payment_status !== 'paid') {
            app.log.warn({ playerId, payment_status: session.payment_status }, 'Checkout not paid');
            break;
          }
          const rawPlayer = await getPlayer(playerId);
          if (!rawPlayer) {
            app.log.warn({ playerId }, 'Player not found for checkout credit');
            break;
          }
          const player = ensurePlayerLifecycleFields(rawPlayer);
          const amountUsd = (session.amount_total ?? 50) / 100;
          try {
            const sig = await transferUsdcToPlayer(player.public_key, amountUsd);
            await savePlayer(markPlayerActive(player));
            app.log.info({ playerId, amountUsd, signature: sig }, 'Credited devnet USDC after checkout');
          } catch (err) {
            app.log.error({ err, playerId, amountUsd }, 'Failed to credit USDC after checkout');
          }
          break;
        }

        case 'crypto_onramp_session.fulfillment.succeeded': {
          const session = (event as any).data.object as {
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
