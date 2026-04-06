/**
 * HTTP 服务启动入口（`npm run dev:server`）
 *
 * - 启动时初始化 SQLite 数据库
 * - 启动时从 DB 加载（或创建）session
 * - 关闭时释放 DB 连接
 */
import { buildApp } from '@/app';
import { preloadRagKnowledge } from '@/services/chat-service';
import { initDefaultSession } from '@/services/session-manager';
import { initDb, closeDb } from '@/db/database';
import { SERVER_PORT } from '@/config';

async function start() {
  const app = buildApp();

  console.log('🎓 English Tutor Agent API — initializing...');

  initDb();
  initDefaultSession();

  await preloadRagKnowledge().catch(() => {
    /* 错误已在 chat-service 内打印 */
  });

  try {
    // host: '0.0.0.0' 监听所有网卡，局域网内其他设备可通过本机 IP 访问；仅 localhost 则外机不可达
    const address = await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
    console.log(`🚀 Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  /**
   * 优雅关闭：先停接新连接、等进行中的请求结束，再关 DB，避免半断连接与句柄泄漏
   */
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown); // Ctrl+C
  process.on('SIGTERM', shutdown); // docker stop / 进程管理器
}

start();
