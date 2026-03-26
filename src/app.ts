import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chatRoutes } from './routes/chat.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE'],
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { validation?: unknown };
    if (err.validation) {
      return reply.code(400).send({
        error: err.message,
        code: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }

    request.log.error(err);
    return reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  });

  app.register(chatRoutes);

  return app;
}
