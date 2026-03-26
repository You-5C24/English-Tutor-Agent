# Web API 后端搭建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CLI 英语私教 Agent 改造为 Fastify HTTP API，支持多用户会话隔离，同时保留 CLI 入口。

**Architecture:** Service Layer 重构——将 `chat.ts` 拆分为无状态 `ChatService` + 独立 `SessionManager`，Fastify 仅做 HTTP 协议转换。现有模块（classifier、prompts、rag、tools）不改动。

**Tech Stack:** Fastify, @fastify/cors, TypeScript ESM

**Spec:** `docs/superpowers/specs/2026-03-26-web-api-architecture-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/types/session.ts` | Session 接口 + ChatResult 类型定义 |
| Modify | `src/config.ts` | 新增 SERVER_PORT / SESSION_TTL / SESSION_CLEANUP_INTERVAL |
| Create | `src/services/session-manager.ts` | 会话 CRUD + TTL 过期清理 |
| Create | `src/services/chat-service.ts` | 从 chat.ts 重构：无状态业务逻辑 |
| Create | `src/routes/chat.ts` | POST /chat + GET /health 路由 |
| Create | `src/app.ts` | Fastify 实例创建、插件注册、路由注册 |
| Create | `src/server.ts` | HTTP 服务启动入口 |
| Modify | `src/index.ts` | CLI 入口改用 ChatService |
| Delete | `src/chat.ts` | 被 services/chat-service.ts 取代 |
| Modify | `package.json` | 新增依赖、更新 scripts |

---

### Task 1: 安装依赖 + 更新 scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 Fastify 和 CORS 插件**

```bash
npm install fastify @fastify/cors
```

- [ ] **Step 2: 更新 package.json scripts**

将 `package.json` 中的 `scripts` 部分改为：

```json
{
  "scripts": {
    "dev:cli": "tsx --env-file=.env src/index.ts",
    "dev:server": "tsx --env-file=.env src/server.ts",
    "chroma:up": "docker run -d --name chroma-rag -p 8000:8000 -v chroma-rag-data:/chroma/chroma chromadb/chroma",
    "chroma:down": "docker rm -f chroma-rag",
    "chroma:inspect": "tsx --env-file=.env src/rag/inspect-chroma.ts"
  }
}
```

原 `"dev"` 改名为 `"dev:cli"`，新增 `"dev:server"`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add fastify and @fastify/cors dependencies"
```

---

### Task 2: 创建类型定义

**Files:**
- Create: `src/types/session.ts`

- [ ] **Step 1: 创建 src/types/session.ts**

```typescript
import { ChatCompletionMessageParam } from 'openai/resources';
import { Scenario } from '../classifier.js';

export interface Session {
  id: string;
  history: ChatCompletionMessageParam[];
  summary: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface ChatResult {
  reply: string;
  scenario: Scenario;
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
git add src/types/session.ts
git commit -m "feat: add Session and ChatResult type definitions"
```

---

### Task 3: 扩展配置项

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 在 config.ts 末尾添加三个常量**

在 `src/config.ts` 文件末尾追加：

```typescript
/** HTTP 服务监听端口 */
export const SERVER_PORT = Number(process.env.PORT) || 3000;

/** 会话过期时间（毫秒），默认 30 分钟 */
export const SESSION_TTL = 30 * 60 * 1000;

/** 会话清理扫描间隔（毫秒），默认 5 分钟 */
export const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000;
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add server port and session TTL config"
```

---

### Task 4: 创建 SessionManager

**Files:**
- Create: `src/services/session-manager.ts`

- [ ] **Step 1: 创建 src/services/session-manager.ts**

```typescript
import { randomBytes } from 'node:crypto';
import { Session } from '../types/session.js';
import { SESSION_TTL, SESSION_CLEANUP_INTERVAL } from '../config.js';

const sessions = new Map<string, Session>();
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

function generateId(): string {
  return 's_' + randomBytes(12).toString('hex');
}

export function create(): Session {
  const now = Date.now();
  const session: Session = {
    id: generateId(),
    history: [],
    summary: '',
    createdAt: now,
    lastActiveAt: now,
  };
  sessions.set(session.id, session);
  return session;
}

export function get(id: string): Session | undefined {
  return sessions.get(id);
}

export function touch(session: Session): void {
  session.lastActiveAt = Date.now();
}

export function cleanup(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > SESSION_TTL) {
      sessions.delete(id);
      removed++;
    }
  }
  return removed;
}

export function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const removed = cleanup();
    if (removed > 0) {
      console.log(`  [Session] 清理了 ${removed} 个过期会话，剩余 ${sessions.size} 个`);
    }
  }, SESSION_CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/** 当前活跃会话数（调试用） */
export function size(): number {
  return sessions.size;
}
```

关键设计说明：
- `generateId()` 用 `crypto.randomBytes` 生成唯一 ID，前缀 `s_` 方便识别
- `cleanupTimer.unref()` 确保定时器不会阻止 Node.js 进程退出
- `startCleanupTimer` / `stopCleanupTimer` 供 server.ts 在启动/关闭时调用
- TODO: 未来换 Redis 只需改这一个文件的内部实现

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
git add src/services/session-manager.ts
git commit -m "feat: add SessionManager with TTL cleanup"
```

---

### Task 5: 重构 chat.ts → services/chat-service.ts

这是最关键的一步：将 `src/chat.ts` 的逻辑迁移到 `src/services/chat-service.ts`，核心改动是把模块级状态变量改为通过 Session 参数传入。

**Files:**
- Create: `src/services/chat-service.ts`
- Delete: `src/chat.ts`（Task 5 完成后删除）

- [ ] **Step 1: 创建 src/services/chat-service.ts**

将 `src/chat.ts` 的全部内容复制到 `src/services/chat-service.ts`，然后进行以下修改：

**修改 1 — 更新 import 路径**（文件从 `src/` 移到了 `src/services/`，所有相对路径加一层 `../`）：

```typescript
import { ChatCompletionMessageParam } from 'openai/resources';
import { client } from '../client.js';
import { classify, Scenario } from '../classifier.js';
import { baseSystemPrompt } from '../prompts/base.js';
import { vocabularyCot, vocabularyFewShot } from '../prompts/vocabulary.js';
import { grammarCot, grammarFewShot } from '../prompts/grammar.js';
import { expressionCot, expressionFewShot } from '../prompts/expression.js';
import { offTopicCot } from '../prompts/offTopic.js';
import { formatRagContext } from '../prompts/rag.js';
import { initChromaRag, retrieveFromChroma } from '../rag/chroma-store.js';
import { dictionaryTool, executeToolCall } from '../tools/dictionary.js';
import {
  CHAT_MODEL,
  COMPRESS_THRESHOLD,
  KEEP_RECENT_ROUNDS,
  RAG_TOP_K,
  RAG_MIN_SCORE,
  MAX_TOOL_ITERATIONS,
  SUMMARY_MAX_TOKENS,
} from '../config.js';
import { Session, ChatResult } from '../types/session.js';
```

**修改 2 — 删除模块级状态变量**：

删除以下两行：
```typescript
let conversationHistory: ChatCompletionMessageParam[] = [];
let summaryContext = '';
```

保留以下模块级变量（Chroma 是全局共享资源）：
```typescript
let chromaReady: boolean | undefined;
let chromaInitPromise: Promise<void> | undefined;
```

**修改 3 — `compressHistory` 改为接收 Session 参数**：

将函数签名从 `async function compressHistory()` 改为 `async function compressHistory(session: Session)`，内部将所有 `conversationHistory` 替换为 `session.history`，将 `summaryContext` 替换为 `session.summary`：

```typescript
async function compressHistory(session: Session): Promise<void> {
  const totalRounds = session.history.length / 2;
  if (totalRounds < COMPRESS_THRESHOLD) return;

  logContextStatus('压缩前 (Before Compression)', undefined, session);
  console.log(
    `  ⚡ [Memory] 触发压缩! ${totalRounds} 轮 > 阈值 ${COMPRESS_THRESHOLD} 轮，正在生成摘要...`
  );

  const keepMessages = KEEP_RECENT_ROUNDS * 2;
  const oldMessages = session.history.slice(0, -keepMessages);
  const recentMessages = session.history.slice(-keepMessages);

  const newSummary = await generateSummary(oldMessages, session.summary);
  console.log(`  [Memory] 被压缩的消息数: ${oldMessages.length} 条`);
  console.log(`  [Memory] LLM 返回的摘要: "${newSummary}"`);

  session.summary = newSummary;
  session.history = recentMessages;

  logContextStatus('压缩后 (After Compression)', undefined, session);
}
```

**修改 4 — `logContextStatus` 改为接收 Session 参数**：

```typescript
function logContextStatus(label: string, messageCount?: number, session?: Session) {
  const history = session?.history ?? [];
  const summary = session?.summary ?? '';
  const rounds = history.length / 2;
  const summaryStatus = summary
    ? `"${summary.slice(0, 60)}${summary.length > 60 ? '...' : ''}"`
    : '无';
  const lines = [
    `│  历史轮数:    ${rounds} 轮 (${history.length} 条消息)`,
    `│  摘要状态:    ${summaryStatus}`,
  ];
  if (messageCount !== undefined) {
    lines.push(
      `│  发送消息总数: ${messageCount} 条 (system + fewshot + history + 当前输入)`
    );
  }
  const width = 58;
  console.log(`  ╭${'─'.repeat(width)}╮`);
  console.log(
    `  │ 📊 ${label}${' '.repeat(Math.max(0, width - label.length - 4))}│`
  );
  console.log(`  ├${'─'.repeat(width)}┤`);
  for (const line of lines) {
    console.log(
      `  ${line}${' '.repeat(Math.max(0, width + 2 - line.length))}│`
    );
  }
  console.log(`  ╰${'─'.repeat(width)}╯`);
}
```

**修改 5 — `chat()` 函数改为接收 Session 参数并返回 ChatResult**：

```typescript
export async function chat(session: Session, userMessage: string): Promise<ChatResult> {
  const [scenario] = await Promise.all([classify(userMessage), compressHistory(session)]);
  console.log(`  [Router] Detected scenario: ${scenario}`);

  const { cot, fewShot } = scenarioConfig[scenario];
  const systemPrompt = await buildSystemPrompt(scenario, cot, session.summary, userMessage);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...fewShot,
    ...session.history,
    { role: 'user', content: userMessage },
  ];

  logContextStatus(
    `第 ${session.history.length / 2 + 1} 轮对话`,
    messages.length,
    session
  );

  const tools = scenario === 'VOCABULARY' ? [dictionaryTool] : undefined;
  const reply = await runToolLoop(messages, tools);

  session.history.push({ role: 'user', content: userMessage });
  session.history.push({ role: 'assistant', content: reply });

  return { reply, scenario };
}
```

**不需要修改的函数**（保持原样复制）：
- `scenarioConfig`
- `preloadRagKnowledge()`
- `generateSummary()`
- `buildSystemPrompt()`
- `runToolLoop()`

- [ ] **Step 2: 删除旧的 src/chat.ts**

```bash
rm src/chat.ts
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 会报 `src/index.ts` 的导入错误（因为 `chat.ts` 被删了），这是预期的——下一个 Task 会修复。如果除此之外有其他错误，需要先修复。

- [ ] **Step 4: Commit**

```bash
git add src/services/chat-service.ts
git rm src/chat.ts
git commit -m "refactor: extract ChatService from chat.ts with session-based state"
```

---

### Task 6: 更新 CLI 入口

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 重写 src/index.ts**

```typescript
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
```

变化点：
- `import { chat, preloadRagKnowledge } from './chat.js'` → `from './services/chat-service.js'`
- 新增 `import * as sessionManager`
- 创建 `session = sessionManager.create()` 
- `chat(userInput)` → `chat(session, userInput)`，解构取 `reply`

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误输出（index.ts 的导入错误应消失）。

- [ ] **Step 3: 验证 CLI 功能正常**

```bash
npm run dev:cli
```

输入一条消息测试，确认 Agent 正常回复后 `exit` 退出。行为应与改造前完全一致。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor: update CLI entry to use ChatService with session"
```

---

### Task 7: 创建路由

**Files:**
- Create: `src/routes/chat.ts`

- [ ] **Step 1: 创建 src/routes/chat.ts**

```typescript
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
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat.ts
git commit -m "feat: add /chat and /health routes"
```

---

### Task 8: 创建 Fastify 应用实例

**Files:**
- Create: `src/app.ts`

- [ ] **Step 1: 创建 src/app.ts**

```typescript
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
    if (error.validation) {
      return reply.code(400).send({
        error: error.message,
        code: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  });

  app.register(chatRoutes);

  return app;
}
```

设计说明：
- `buildApp()` 是工厂函数，返回配置好的 Fastify 实例
- 分离出来是为了测试：未来可以 `const app = buildApp(); app.inject(...)` 做集成测试，无需启动端口
- `logger: true` 启用 Fastify 内置的 pino 日志
- CORS `origin: true` 允许所有来源（开发阶段）
- `setErrorHandler` 全局错误处理：JSON Schema 校验失败返回 400 + `INVALID_REQUEST`，其他未预期错误返回 500 + `INTERNAL_ERROR`，确保所有错误都是结构化 JSON 格式

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: add Fastify app factory with CORS"
```

---

### Task 9: 创建 Server 启动入口

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: 创建 src/server.ts**

```typescript
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
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add HTTP server entry with graceful shutdown"
```

---

### Task 10: 端到端手动测试

**Files:** 无新增/修改，纯验证

- [ ] **Step 1: 启动 server**

```bash
npm run dev:server
```

Expected: 看到类似以下输出：
```
🎓 English Tutor Agent API — loading RAG knowledge base...
🚀 Server listening at http://0.0.0.0:3000
```

- [ ] **Step 2: 测试 health 端点**

新开一个终端：

```bash
curl http://localhost:3000/health
```

Expected:
```json
{"ok":true}
```

- [ ] **Step 3: 测试创建新会话**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What does brilliant mean?"}'
```

Expected: 返回包含 `reply`、`sessionId`（形如 `s_xxx...`）和 `scenario`（应为 `VOCABULARY`）的 JSON。
记下返回的 `sessionId` 值。

- [ ] **Step 4: 测试已有会话连续对话**

用上一步拿到的 sessionId 替换 `<YOUR_SESSION_ID>`：

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Can you give me an example sentence?", "sessionId": "<YOUR_SESSION_ID>"}'
```

Expected: 返回与上下文相关的回复（AI 应该记得之前聊过 brilliant）。

- [ ] **Step 5: 测试错误场景 — 无效 sessionId**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "hello", "sessionId": "s_nonexistent"}'
```

Expected:
```json
{"error":"Session not found","code":"SESSION_NOT_FOUND","statusCode":404}
```

- [ ] **Step 6: 测试错误场景 — 缺少 message**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "s_abc"}'
```

Expected: HTTP 400，返回结构化错误：
```json
{"error":"...","code":"INVALID_REQUEST","statusCode":400}
```

- [ ] **Step 7: 停止 server 验证优雅关闭**

在 server 运行的终端按 `Ctrl+C`。

Expected: 看到 `🛑 Shutting down...`，进程正常退出。

- [ ] **Step 8: 验证 CLI 仍然正常**

```bash
npm run dev:cli
```

输入一条消息测试，确认回复正常。`exit` 退出。

- [ ] **Step 9: 最终 Commit（如有遗漏的文件变更）**

如果 `git status` 显示有未提交的变更，执行以下提交。如果工作区干净则跳过此步。

```bash
git add -A
git commit -m "feat: complete Web API backend with Fastify

- POST /chat with session-based multi-user support
- GET /health endpoint
- SessionManager with TTL auto-cleanup
- ChatService refactored from chat.ts (stateless)
- CLI entry preserved and working
- CORS enabled for frontend integration"
```

---

## 完成确认清单

全部 Task 完成后，确认以下全部成立：

- [ ] `npm run dev:server` 启动无报错
- [ ] `curl /health` 返回 `{"ok":true}`
- [ ] `POST /chat` 不带 sessionId 创建新会话，返回 reply + sessionId + scenario
- [ ] `POST /chat` 带 sessionId 维持上下文
- [ ] 无效 sessionId 返回 404
- [ ] 缺少 message 返回 400
- [ ] `Ctrl+C` 优雅退出
- [ ] `npm run dev:cli` CLI 功能不受影响
- [ ] `npx tsc --noEmit` 无 TypeScript 错误
