import { FastifyInstance } from 'fastify';
import { chat } from '../services/chat-service.js';
import * as sessionManager from '../services/session-manager.js';

interface ChatBody {
  message: string;
  sessionId?: string;
}

interface ChatResponse {
  reply: string;
  sessionId: string;
  scenario: string;
}

interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatBody; Reply: ChatResponse | ErrorResponse }>(
    '/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 5000 },
            sessionId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { message, sessionId } = request.body;

      let session;
      if (sessionId && sessionId.length > 0) {
        session = sessionManager.get(sessionId);
        if (!session) {
          return reply.code(404).send({
            error: 'Session not found',
            code: 'SESSION_NOT_FOUND',
            statusCode: 404,
          });
        }
      } else {
        session = sessionManager.create();
      }

      try {
        const result = await chat(session, message);
        sessionManager.touch(session);

        return reply.code(200).send({
          reply: result.reply,
          sessionId: session.id,
          scenario: result.scenario,
        });
      } catch (err) {
        request.log.error(err, 'Chat processing failed');
        return reply.code(500).send({
          error: 'Failed to process message',
          code: 'LLM_ERROR',
          statusCode: 500,
        });
      }
    }
  );

  app.get('/health', async () => {
    return { ok: true };
  });
}
