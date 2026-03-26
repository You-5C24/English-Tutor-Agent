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
    const address = await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
    console.log(`🚀 Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    stopCleanupTimer();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
