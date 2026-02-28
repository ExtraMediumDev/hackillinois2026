import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * X-API-Key header authentication middleware.
 * Skips auth for the /health endpoint and /v1/webhooks/* routes
 * (webhooks are authenticated by Stripe signature instead).
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { url } = request.raw;
  if (url === '/health' || url?.startsWith('/v1/webhooks/')) return;

  const apiKey = request.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    reply.code(401).send({
      status: 'error',
      statusCode: 401,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid X-API-Key header.',
        remediation: 'Provide a valid API key in the X-API-Key header.',
      },
    });
  }
}
