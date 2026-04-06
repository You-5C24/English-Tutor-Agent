/**
 * HTTP 路由定义 — API 的"门面"
 *
 * Phase 3 变更：
 * - POST /chat 不再需要 sessionId，使用后端唯一 session
 * - 新增 GET /history 加载最近消息
 * - 新增 POST /reset 重置对话
 * - chat 成功后在同一事务中持久化 session + messages
 */
import { FastifyInstance } from 'fastify';
import { chat } from '../services/chat-service.js';
import * as sessionManager from '../services/session-manager.js';
import * as messageRepo from '../db/message-repo.js';
import { runTransaction } from '../db/database.js';

/** 与 `web/src/hooks/useConversation.ts` 一致：优先 `randomUUID`，否则时间戳 + 随机串 */
function newMessageId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

interface ChatBody {
  message: string;
}

interface ChatResponse {
  reply: string;
  scenario: string;
}

interface HistoryResponse {
  messages: messageRepo.MessageRow[];
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
          },
        },
      },
    },
    async (request, reply) => {
      const { message } = request.body;
      const session = sessionManager.getDefaultSession();

      try {
        const result = await chat(session, message);

        const now = Date.now();
        runTransaction(() => {
          sessionManager.save();
          messageRepo.addMessage({
            id: newMessageId(),
            role: 'user',
            content: message,
            scenario: null,
            timestamp: now - 1,
          });
          messageRepo.addMessage({
            id: newMessageId(),
            role: 'assistant',
            content: result.reply,
            scenario: result.scenario,
            timestamp: now,
          });
        });

        return reply.code(200).send({
          reply: result.reply,
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

  /** GET /history — 返回最近 30 条消息供前端展示 */
  app.get<{ Reply: HistoryResponse }>('/history', async () => {
    const messages = messageRepo.getRecentMessages();
    return { messages };
  });

  /** POST /reset — 清空对话记忆，重新开始 */
  app.post<{ Reply: { ok: true } }>('/reset', async () => {
    runTransaction(() => {
      messageRepo.deleteAllMessages();
      sessionManager.reset();
    });
    return { ok: true };
  });

  app.get('/health', async () => {
    return { ok: true };
  });
}
