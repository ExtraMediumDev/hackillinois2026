import { FastifyRequest, FastifyReply } from 'fastify';
import {
  getIdempotencyRecord,
  setIdempotencyProcessing,
  setIdempotencyCompleted,
} from './redis';

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * Two-phase idempotency middleware factory.
 *
 * Usage: wrap a route handler with withIdempotency(handler)
 *
 * Flow:
 *  1. If no Idempotency-Key header → 400
 *  2. If record.status === 'processing' → 409 (in-flight)
 *  3. If record.status === 'completed' → replay cached response
 *  4. SET NX processing lock; if fails → 409 (concurrent request)
 *  5. Run handler, cache result, return
 */
export function withIdempotency(handler: RouteHandler): RouteHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') {
      return reply.code(400).send({
        status: 'error',
        statusCode: 400,
        error: {
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header is required for this endpoint.',
          remediation: 'Generate a UUID (e.g. uuidgen) and pass it as Idempotency-Key.',
        },
      });
    }

    const existing = await getIdempotencyRecord(key);

    if (existing?.status === 'processing') {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'REQUEST_IN_FLIGHT',
          message: 'This request is currently being processed.',
          remediation: 'Wait a moment and retry.',
        },
      });
    }

    if (existing?.status === 'completed') {
      return reply.send(existing.response);
    }

    const locked = await setIdempotencyProcessing(key);
    if (!locked) {
      return reply.code(409).send({
        status: 'error',
        statusCode: 409,
        error: {
          code: 'CONCURRENT_REQUEST',
          message: 'A concurrent request with this Idempotency-Key was detected.',
          remediation: 'Use a unique Idempotency-Key per logical request.',
        },
      });
    }

    const result = await handler(request, reply);
    await setIdempotencyCompleted(key, result);
    return result;
  };
}
