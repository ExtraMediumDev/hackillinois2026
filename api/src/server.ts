import 'dotenv/config';
import Fastify, { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';

import { authMiddleware } from './middleware/auth';
import playerRoutes from './routes/players';
import gameRoutes from './routes/games';
import webhookRoutes from './routes/webhooks';
import { IgniteError } from './types';

const app = Fastify({ logger: true });

// Plugins
app.register(sensible);
app.register(cors, { origin: true });

// Auth on all non-webhook routes
app.addHook('preHandler', authMiddleware);

// Routes
app.register(playerRoutes, { prefix: '/v1' });
app.register(gameRoutes, { prefix: '/v1' });
app.register(webhookRoutes, { prefix: '/v1' });

// Global error handler
app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
  const igniteError = (error as unknown as { igniteError?: IgniteError }).igniteError;
  if (igniteError) {
    return reply.code(igniteError.statusCode).send(igniteError);
  }

  const statusCode = error.statusCode ?? 500;
  const response: IgniteError = {
    status: 'error',
    statusCode,
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: error.message ?? 'An unexpected error occurred.',
      remediation: 'Please try again or contact support.',
    },
  };
  reply.code(statusCode).send(response);
});

// Health check (no auth required — registered before auth hook)
app.get('/health', { preHandler: [] }, async () => ({ status: 'ok', version: '1.0.0' }));

const start = async () => {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Ignite API running on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
