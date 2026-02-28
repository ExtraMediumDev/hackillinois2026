import 'dotenv/config';
import Fastify, { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import fastifyRawBody from 'fastify-raw-body';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { authMiddleware } from './middleware/auth';
import playerRoutes from './routes/players';
import webhookRoutes from './routes/webhooks';
import { IgniteError } from './types';

const app = Fastify({ logger: true });

// Auth on all non-webhook routes
app.addHook('preHandler', authMiddleware);

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
  await app.register(sensible);
  await app.register(cors, { origin: true });
  await app.register(fastifyRawBody, {
    global: false,
    encoding: false,
    runFirst: true,
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Ignite API',
        description: 'Web2-to-Web3 gaming bridge API — HackIllinois 2026',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server',
        },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  app.register(playerRoutes, { prefix: '/v1' });
  app.register(webhookRoutes, { prefix: '/v1' });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Splice API running on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
