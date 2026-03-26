/**
 * CLI 入口 — 命令行交互模式
 *
 * 改造前：直接调用 chat(userInput)，对话状态存在 chat.ts 的模块级变量里
 * 改造后：创建一个 Session 对象，调用 chat(session, userInput)
 * 行为完全一致，只是状态从"隐式全局"变成了"显式传入"。
 *
 * 这个入口和 server.ts 共享同一套 ChatService 业务逻辑，
 * 区别只是 I/O 方式不同（readline vs HTTP）。
 */
import readline from 'node:readline';
import { chat, preloadRagKnowledge } from './services/chat-service.js';
import * as sessionManager from './services/session-manager.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

async function main() {
  console.log('🎓 English Tutor Agent — loading RAG knowledge base...');
  await preloadRagKnowledge().catch(() => {
    /* 错误已在 chat-service 内打印 */
  });
  console.log('Ready! Type your message (or "exit" to quit):\n');

  const session = sessionManager.create();

  while (true) {
    const userInput = await askQuestion('You: ');

    if (userInput.trim().toLowerCase() === 'exit' || userInput.trim().toLowerCase() === 'quit') {
      console.log('\nGoodbye! Keep practicing your English! 👋');
      rl.close();
      break;
    }

    if (!userInput.trim()) continue;

    try {
      const { reply } = await chat(session, userInput);
      console.log(`\nTutor: ${reply}\n`);
    } catch (error) {
      console.error('\n[Error] Failed to get response:', error);
    }
  }
}

main();
