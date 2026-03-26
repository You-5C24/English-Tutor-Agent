/**
 * HTTP 服务启动入口 — Web API 的"main 函数"
 *
 * 和 index.ts（CLI 入口）平级，是项目的两个入口之一：
 *   npm run dev:cli    → index.ts（命令行交互）
 *   npm run dev:server → server.ts（HTTP API）
 *
 * 启动顺序：
 *   1. buildApp()          — 创建 Fastify 实例，注册插件和路由
 *   2. preloadRagKnowledge — 预连接 Chroma 并灌入知识库（避免第一个请求等待）
 *   3. startCleanupTimer   — 启动会话过期清理定时器
 *   4. app.listen           — 开始监听 HTTP 请求
 *
 * 关闭时（Ctrl+C 或 kill 信号）：停止定时器 → 关闭 HTTP 连接 → 退出进程
 */
import { buildApp } from './app.js';
import { preloadRagKnowledge } from './services/chat-service.js';
import { startCleanupTimer, stopCleanupTimer } from './services/session-manager.js';
import { SERVER_PORT } from './config.js';

async function start() {
  const app = buildApp();

  console.log('🎓 English Tutor Agent API — loading RAG knowledge base...');
  await preloadRagKnowledge().catch(() => {
    /* 错误已在 chat-service 内打印 */
  });

  startCleanupTimer();

  try {
    // host: '0.0.0.0' 表示监听所有网卡，这样局域网内其他设备也能访问
    // 如果只写 'localhost' 或 '127.0.0.1'，则只有本机能访问
    const address = await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
    console.log(`🚀 Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  /**
   * 优雅关闭（Graceful Shutdown）
   *
   * 为什么不直接 process.exit()？
   * 因为可能有正在处理中的请求。app.close() 会：
   *   1. 停止接受新连接
   *   2. 等待正在处理的请求完成
   *   3. 然后才关闭
   * 这样不会出现用户请求发到一半，服务器突然断开的情况。
   */
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    stopCleanupTimer();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);   // Ctrl+C
  process.on('SIGTERM', shutdown);  // docker stop / kill 发送的信号
}

start();
