/**
 * Fastify 应用工厂 — 创建配置好的 Fastify 实例
 *
 * 为什么用工厂函数而不是直接导出实例？
 * 这样做的好处是可测试性：未来写集成测试时可以 const app = buildApp()，
 * 然后用 Fastify 内置的 app.inject() 模拟请求，无需真的启动端口监听。
 *
 * 这个文件只做"装配"——注册插件、错误处理、路由，不包含启动逻辑。
 * 启动逻辑在 server.ts 中（监听端口、优雅关闭等）。
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chatRoutes } from './routes/chat.js';

export function buildApp() {
  // logger: true 启用 Fastify 内置的 pino 日志，自动记录每个请求的耗时、状态码等
  const app = Fastify({ logger: true });

  // CORS（跨域资源共享）：允许浏览器中的前端页面调用这个 API。
  // origin: true 表示允许所有来源（开发阶段），生产环境应限制为具体域名。
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE'],
  });

  /**
   * 全局错误处理 — 确保所有错误都以统一的 JSON 格式返回
   *
   * Fastify 有两类错误会走到这里：
   * 1. JSON Schema 校验失败（如缺少 message 字段）→ error 对象带 validation 属性 → 400
   * 2. 其他未捕获的异常（如代码 bug）→ 500
   *
   * 路由内部 try/catch 捕获的错误（如 LLM 调用失败）不会走到这里，
   * 它们在路由的 catch 块里已经被处理了。
   */
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
