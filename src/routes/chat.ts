/**
 * HTTP 路由定义 — API 的"门面"
 *
 * 这一层只做三件事：
 * 1. 解析 HTTP 请求（Fastify 自动按 JSON Schema 校验）
 * 2. 调用 SessionManager + ChatService 完成业务逻辑
 * 3. 构造 HTTP 响应返回给前端
 *
 * 路由层不包含任何业务逻辑（分类、prompt 组装、LLM 调用等都在 ChatService 中），
 * 这样 ChatService 可以同时被 HTTP 路由和 CLI 入口复用。
 */
import { FastifyInstance } from 'fastify';
import { chat } from '../services/chat-service.js';
import * as sessionManager from '../services/session-manager.js';

/** POST /chat 请求体 */
interface ChatBody {
  message: string;
  sessionId?: string;  // 可选：不传或空字符串 → 创建新会话
}

/** POST /chat 成功响应 */
interface ChatResponse {
  reply: string;       // AI 回复
  sessionId: string;   // 前端需保存此值，下次请求带上以维持对话
  scenario: string;    // 命中的教学场景，前端可用于调试或 UI 展示
}

/** 所有错误响应的统一格式 */
interface ErrorResponse {
  error: string;       // 人类可读的错误描述
  code: string;        // 机器可读的错误码，前端可据此做分支处理
  statusCode: number;  // 和 HTTP 状态码一致，方便前端不用解析 header
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /chat — 核心对话端点
   *
   * schema: Fastify 内置的 JSON Schema 校验，不合法的请求会被 app.ts 的
   *         全局 errorHandler 拦截并返回 400 INVALID_REQUEST，不会进入 handler。
   */
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

      // —— 会话解析逻辑 ——
      // sessionId 缺省或空字符串 → 新建会话（首次对话）
      // sessionId 非空但找不到 → 404（可能过期被清理了，前端应引导用户开新会话）
      // sessionId 非空且找到 → 继续对话
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
        // touch 放在 chat 成功之后：只有成功的对话才续期 TTL，
        // 失败的请求不应该延长会话的生命周期
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

  /** GET /health — 健康检查，用于监控和部署验证 */
  app.get('/health', async () => {
    return { ok: true };
  });
}
