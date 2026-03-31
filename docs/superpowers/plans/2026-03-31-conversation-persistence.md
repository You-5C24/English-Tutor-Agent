# 对话记忆持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现单用户连续记忆——Agent 跨浏览器刷新和服务器重启后仍记住对话上下文，支持"重新开始"。

**Architecture:** 新增 `src/db/` 持久化层（Repository 模式），用 SQLite 存储 session 状态和展示消息。session-manager 从多 session Map 重构为单 session 持久化管理器。前端挂载时从 `GET /api/history` 加载历史，新增 `POST /api/reset` 支持重置对话。

**Tech Stack:** better-sqlite3, Vitest (backend tests), Fastify 5, React 19

**Spec:** `docs/superpowers/specs/2026-03-31-conversation-persistence-design.md`

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `package.json` | Modify | 新增 `better-sqlite3`、`@types/better-sqlite3`、`vitest`；新增 `test` script；移除 `dev:cli` |
| `vitest.config.ts` | Create | 后端测试配置 |
| `.gitignore` | Modify | 添加 `data/` |
| `src/config.ts` | Modify | 新增 `DB_PATH`、`DISPLAY_MESSAGE_LIMIT`；移除 `SESSION_TTL`、`SESSION_CLEANUP_INTERVAL` |
| `src/db/database.ts` | Create | SQLite 连接单例 + 建表 + 事务辅助 |
| `src/db/session-repo.ts` | Create | sessions 表 CRUD |
| `src/db/message-repo.ts` | Create | messages 表 CRUD |
| `src/db/__tests__/session-repo.test.ts` | Create | session-repo 单元测试 |
| `src/db/__tests__/message-repo.test.ts` | Create | message-repo 单元测试 |
| `src/services/__tests__/session-manager.test.ts` | Create | session-manager 单元测试 |
| `src/services/session-manager.ts` | Rewrite | 单 session 持久化管理器 |
| `src/routes/chat.ts` | Modify | 简化 chat、新增 GET /history、POST /reset |
| `src/server.ts` | Modify | 启动时初始化 DB + session |
| `src/index.ts` | Delete | 移除 CLI 入口 |
| `web/src/types/chat.ts` | Modify | 移除 sessionId，新增 HistoryResponse |
| `web/src/api/chat.ts` | Modify | 新增 fetchHistory、resetConversation；移除 sessionId |
| `web/src/hooks/useConversation.ts` | Modify | 挂载加载历史、移除 sessionId、新增 resetConversation |
| `web/src/hooks/__tests__/useConversation.test.ts` | Modify | 更新测试适配新接口 |
| `web/src/components/ChatWindow.tsx` | Modify | 新增"重新开始"按钮 |

不动的文件：`chat-service.ts`、`classifier.ts`、`client.ts`、`types/session.ts`、`prompts/*`、`rag/*`、`tools/*`、`app.ts`、`MessageBubble.tsx`、`MessageList.tsx`、`ChatInput.tsx`、`App.tsx`、`App.css`。

---

## Task 1: 安装依赖 + 后端测试框架

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 安装 better-sqlite3 和 vitest**

```bash
cd /Users/5c24/Documents/worksapce/English-Tutor-Agent
npm install better-sqlite3
npm install -D @types/better-sqlite3 vitest
```

`better-sqlite3` 是原生 Node 模块，安装时需要编译（macOS 需已安装 Xcode Command Line Tools）。如果编译失败，运行 `xcode-select --install`。

- [ ] **Step 2: 创建后端 vitest 配置**

创建 `vitest.config.ts`（项目根目录）：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: 在 package.json 中添加 test script**

在 `scripts` 中添加：

```json
"test": "vitest run"
```

- [ ] **Step 4: 验证 vitest 能正常启动**

```bash
npm test
```

Expected: `No test files found`（还没有测试文件），不报错即可。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add better-sqlite3 and vitest for backend tests"
```

---

## Task 2: 配置更新 + .gitignore

**Files:**
- Modify: `src/config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 更新 config.ts**

在 `src/config.ts` 中新增两个常量，移除两个不再需要的常量：

新增（文件末尾添加）：

```typescript
/** SQLite 数据库文件路径（相对于项目根目录） */
export const DB_PATH = 'data/english-tutor.db';

/** 前端历史消息加载条数上限 */
export const DISPLAY_MESSAGE_LIMIT = 30;
```

移除以下两行：

```typescript
/** 会话过期时间（毫秒），默认 30 分钟 */
export const SESSION_TTL = 30 * 60 * 1000;

/** 会话清理扫描间隔（毫秒），默认 5 分钟 */
export const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000;
```

- [ ] **Step 2: 在 .gitignore 末尾添加 data/**

```
# SQLite database files
data/
```

- [ ] **Step 3: Commit**

```bash
git add src/config.ts .gitignore
git commit -m "chore: add DB_PATH config, remove TTL config, gitignore data/"
```

---

## Task 3: 创建 database.ts

**Files:**
- Create: `src/db/database.ts`

- [ ] **Step 1: 创建 src/db/database.ts**

```typescript
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 项目根目录：从 src/db/ 向上两级 */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

let db: DatabaseType | undefined;

/**
 * 初始化 SQLite 连接并建表。
 * 传入 ':memory:' 可创建内存数据库（用于测试）。
 */
export function initDb(dbPath?: string): void {
  if (db) return;

  const resolvedPath = dbPath ?? resolve(PROJECT_ROOT, DB_PATH);

  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      history TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      scenario TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
  `);
}

/** 获取已初始化的数据库连接 */
export function getDb(): DatabaseType {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/** 关闭数据库连接（服务器关闭或测试清理时调用） */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

/** 在单个 SQLite 事务中执行多个操作 */
export function runTransaction(fn: () => void): void {
  getDb().transaction(fn)();
}
```

- [ ] **Step 2: 验证 TypeScript 编译无报错**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```

Expected: 无错误输出（会有 `src/index.ts` 和 `src/services/session-manager.ts` 引用旧的 `SESSION_TTL` 等报错——这是预期的，后续 task 会修复）。只要 `src/db/database.ts` 本身无编译错误即可。

- [ ] **Step 3: Commit**

```bash
git add src/db/database.ts
git commit -m "feat: add SQLite database initialization module"
```

---

## Task 4: session-repo（TDD）

**Files:**
- Create: `src/db/__tests__/session-repo.test.ts`
- Create: `src/db/session-repo.ts`

- [ ] **Step 1: 编写 session-repo 失败测试**

创建 `src/db/__tests__/session-repo.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../database.js';
import { loadSession, saveSession, resetSession } from '../session-repo.js';
import type { Session } from '../../types/session.js';

beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

describe('session-repo', () => {
  it('returns null when no session exists', () => {
    const session = loadSession();
    expect(session).toBeNull();
  });

  it('saves and loads a session with data integrity', () => {
    const session: Session = {
      id: 'default',
      history: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
      summary: 'User said hello',
      createdAt: 1000,
      lastActiveAt: 2000,
    };

    saveSession(session);
    const loaded = loadSession();

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('default');
    expect(loaded!.summary).toBe('User said hello');
    expect(loaded!.history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(loaded!.createdAt).toBe(1000);
    expect(loaded!.lastActiveAt).toBe(2000);
  });

  it('overwrites existing session on save (upsert)', () => {
    const session: Session = {
      id: 'default',
      history: [],
      summary: 'old',
      createdAt: 1000,
      lastActiveAt: 1000,
    };
    saveSession(session);

    session.summary = 'updated';
    session.lastActiveAt = 3000;
    saveSession(session);

    const loaded = loadSession();
    expect(loaded!.summary).toBe('updated');
    expect(loaded!.lastActiveAt).toBe(3000);
  });

  it('resets session by deleting from DB', () => {
    const session: Session = {
      id: 'default',
      history: [{ role: 'user', content: 'test' }],
      summary: 'some summary',
      createdAt: 1000,
      lastActiveAt: 2000,
    };
    saveSession(session);
    expect(loadSession()).not.toBeNull();

    resetSession();
    expect(loadSession()).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/db/__tests__/session-repo.test.ts
```

Expected: FAIL — `Cannot find module '../session-repo.js'`

- [ ] **Step 3: 实现 session-repo.ts**

创建 `src/db/session-repo.ts`：

```typescript
import { getDb } from './database.js';
import type { Session } from '../types/session.js';

const DEFAULT_SESSION_ID = 'default';

interface SessionRow {
  id: string;
  summary: string;
  history: string;
  created_at: number;
  last_active_at: number;
}

/** 从 DB 加载唯一 session，不存在返回 null */
export function loadSession(): Session | null {
  const row = getDb()
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(DEFAULT_SESSION_ID) as SessionRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    summary: row.summary,
    history: JSON.parse(row.history),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

/** 保存 session（INSERT OR REPLACE，首次和更新通用） */
export function saveSession(session: Session): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO sessions (id, summary, history, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      DEFAULT_SESSION_ID,
      session.summary,
      JSON.stringify(session.history),
      session.createdAt,
      session.lastActiveAt,
    );
}

/** 从 DB 删除 session */
export function resetSession(): void {
  getDb()
    .prepare('DELETE FROM sessions WHERE id = ?')
    .run(DEFAULT_SESSION_ID);
}
```

- [ ] **Step 4: 运行测试确认全部通过**

```bash
npx vitest run src/db/__tests__/session-repo.test.ts
```

Expected: 4 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/db/session-repo.ts src/db/__tests__/session-repo.test.ts
git commit -m "feat: add session-repo with SQLite persistence"
```

---

## Task 5: message-repo（TDD）

**Files:**
- Create: `src/db/__tests__/message-repo.test.ts`
- Create: `src/db/message-repo.ts`

- [ ] **Step 1: 编写 message-repo 失败测试**

创建 `src/db/__tests__/message-repo.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../database.js';
import { addMessage, getRecentMessages, deleteAllMessages } from '../message-repo.js';
import type { MessageRow } from '../message-repo.js';

beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

describe('message-repo', () => {
  it('returns empty array when no messages exist', () => {
    const messages = getRecentMessages();
    expect(messages).toEqual([]);
  });

  it('adds and retrieves a message', () => {
    const msg: MessageRow = {
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      scenario: null,
      timestamp: 1000,
    };
    addMessage(msg);

    const messages = getRecentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it('returns messages in chronological order (ASC)', () => {
    addMessage({ id: 'msg-1', role: 'user', content: 'first', scenario: null, timestamp: 1000 });
    addMessage({ id: 'msg-2', role: 'assistant', content: 'second', scenario: 'VOCABULARY', timestamp: 2000 });
    addMessage({ id: 'msg-3', role: 'user', content: 'third', scenario: null, timestamp: 3000 });

    const messages = getRecentMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[1].id).toBe('msg-2');
    expect(messages[2].id).toBe('msg-3');
  });

  it('limits to most recent N messages', () => {
    for (let i = 1; i <= 5; i++) {
      addMessage({ id: `msg-${i}`, role: 'user', content: `msg ${i}`, scenario: null, timestamp: i * 1000 });
    }

    const messages = getRecentMessages(3);
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('msg-3');
    expect(messages[1].id).toBe('msg-4');
    expect(messages[2].id).toBe('msg-5');
  });

  it('deletes all messages', () => {
    addMessage({ id: 'msg-1', role: 'user', content: 'hello', scenario: null, timestamp: 1000 });
    addMessage({ id: 'msg-2', role: 'assistant', content: 'hi', scenario: 'VOCABULARY', timestamp: 2000 });

    deleteAllMessages();

    const messages = getRecentMessages();
    expect(messages).toEqual([]);
  });

  it('deleteAll on empty table does not throw', () => {
    expect(() => deleteAllMessages()).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/db/__tests__/message-repo.test.ts
```

Expected: FAIL — `Cannot find module '../message-repo.js'`

- [ ] **Step 3: 实现 message-repo.ts**

创建 `src/db/message-repo.ts`：

```typescript
import { getDb } from './database.js';
import { DISPLAY_MESSAGE_LIMIT } from '../config.js';

export interface MessageRow {
  id: string;
  role: string;
  content: string;
  scenario: string | null;
  timestamp: number;
}

/** 追加一条消息到 messages 表 */
export function addMessage(msg: MessageRow): void {
  getDb()
    .prepare(
      'INSERT INTO messages (id, role, content, scenario, timestamp) VALUES (?, ?, ?, ?, ?)'
    )
    .run(msg.id, msg.role, msg.content, msg.scenario, msg.timestamp);
}

/**
 * 获取最近 N 条消息，按时间正序返回（上旧下新）。
 * SQL：子查询 DESC LIMIT N 取最近 N 条，外层 ASC 排序。
 */
export function getRecentMessages(limit: number = DISPLAY_MESSAGE_LIMIT): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?
       ) ORDER BY timestamp ASC`
    )
    .all(limit) as MessageRow[];
}

/** 清空全部消息 */
export function deleteAllMessages(): void {
  getDb().prepare('DELETE FROM messages').run();
}
```

- [ ] **Step 4: 运行测试确认全部通过**

```bash
npx vitest run src/db/__tests__/message-repo.test.ts
```

Expected: 6 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/db/message-repo.ts src/db/__tests__/message-repo.test.ts
git commit -m "feat: add message-repo with SQLite persistence"
```

---

## Task 6: 重构 session-manager（TDD）

**Files:**
- Create: `src/services/__tests__/session-manager.test.ts`
- Rewrite: `src/services/session-manager.ts`

- [ ] **Step 1: 编写 session-manager 失败测试**

创建 `src/services/__tests__/session-manager.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../db/database.js';
import * as sessionRepo from '../../db/session-repo.js';
import {
  initDefaultSession,
  getDefaultSession,
  save,
  reset,
} from '../session-manager.js';

beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

describe('session-manager', () => {
  it('creates a new default session when DB is empty', () => {
    initDefaultSession();
    const session = getDefaultSession();

    expect(session.id).toBe('default');
    expect(session.history).toEqual([]);
    expect(session.summary).toBe('');
  });

  it('writes new session to DB on init', () => {
    initDefaultSession();
    const fromDb = sessionRepo.loadSession();

    expect(fromDb).not.toBeNull();
    expect(fromDb!.id).toBe('default');
  });

  it('restores session from DB when data exists', () => {
    sessionRepo.saveSession({
      id: 'default',
      history: [{ role: 'user', content: 'hello' }],
      summary: 'previous summary',
      createdAt: 1000,
      lastActiveAt: 2000,
    });

    initDefaultSession();
    const session = getDefaultSession();

    expect(session.summary).toBe('previous summary');
    expect(session.history).toEqual([{ role: 'user', content: 'hello' }]);
    expect(session.createdAt).toBe(1000);
  });

  it('throws if getDefaultSession called before init', () => {
    expect(() => getDefaultSession()).toThrow('Session not initialized');
  });

  it('save() persists session state to DB', () => {
    initDefaultSession();
    const session = getDefaultSession();

    session.history.push({ role: 'user', content: 'test' });
    session.summary = 'new summary';
    save();

    const fromDb = sessionRepo.loadSession();
    expect(fromDb!.summary).toBe('new summary');
    expect(fromDb!.history).toEqual([{ role: 'user', content: 'test' }]);
  });

  it('reset() clears session and DB', () => {
    initDefaultSession();
    const session = getDefaultSession();
    session.history.push({ role: 'user', content: 'test' });
    session.summary = 'some summary';
    save();

    reset();

    const resetted = getDefaultSession();
    expect(resetted.history).toEqual([]);
    expect(resetted.summary).toBe('');

    const fromDb = sessionRepo.loadSession();
    expect(fromDb).not.toBeNull();
    expect(fromDb!.history).toEqual([]);
    expect(fromDb!.summary).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/services/__tests__/session-manager.test.ts
```

Expected: FAIL — 旧的 session-manager 没有 `initDefaultSession` 等导出。

- [ ] **Step 3: 重写 session-manager.ts**

将 `src/services/session-manager.ts` 的完整内容替换为：

```typescript
/**
 * 会话管理器 — 单用户持久化 Session 管理
 *
 * Phase 3 重构：从多 session 内存 Map 改为单 session + SQLite 持久化。
 * 启动时从 DB 加载唯一 session，运行时在内存中操作，chat 成功后写入 DB。
 */
import { Session } from '../types/session.js';
import * as sessionRepo from '../db/session-repo.js';

let defaultSession: Session | undefined;

/** 从 DB 加载 session，若不存在则创建空 session 并写入 DB */
export function initDefaultSession(): void {
  const loaded = sessionRepo.loadSession();

  if (loaded) {
    defaultSession = loaded;
    console.log('  [Session] 已从数据库恢复会话');
  } else {
    const now = Date.now();
    defaultSession = {
      id: 'default',
      history: [],
      summary: '',
      createdAt: now,
      lastActiveAt: now,
    };
    sessionRepo.saveSession(defaultSession);
    console.log('  [Session] 已创建新会话');
  }
}

/** 获取内存中的唯一 session */
export function getDefaultSession(): Session {
  if (!defaultSession) {
    throw new Error('Session not initialized. Call initDefaultSession() first.');
  }
  return defaultSession;
}

/** 将当前 session 状态持久化到 DB */
export function save(): void {
  if (!defaultSession) return;
  defaultSession.lastActiveAt = Date.now();
  sessionRepo.saveSession(defaultSession);
}

/** 清空 session 记忆并持久化 */
export function reset(): void {
  const now = Date.now();
  defaultSession = {
    id: 'default',
    history: [],
    summary: '',
    createdAt: now,
    lastActiveAt: now,
  };
  sessionRepo.resetSession();
  sessionRepo.saveSession(defaultSession);
}
```

- [ ] **Step 4: 运行测试确认全部通过**

```bash
npx vitest run src/services/__tests__/session-manager.test.ts
```

Expected: 6 个测试全部 PASS。

- [ ] **Step 5: 运行全部后端测试确认无回归**

```bash
npm test
```

Expected: session-repo（4）+ message-repo（6）+ session-manager（6）= 16 个测试全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/services/session-manager.ts src/services/__tests__/session-manager.test.ts
git commit -m "feat: rewrite session-manager as single-session persistence manager"
```

---

## Task 7: 删除 CLI 入口

**Files:**
- Delete: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: 删除 src/index.ts**

```bash
rm src/index.ts
```

- [ ] **Step 2: 从 package.json 移除 dev:cli script**

将 `scripts` 中的 `"dev:cli"` 行删除：

```json
"scripts": {
  "dev:server": "tsx --env-file=.env src/server.ts",
  "test": "vitest run",
  "chroma:up": "docker run -d --name chroma-rag -p 8000:8000 -v chroma-rag-data:/chroma/chroma chromadb/chroma",
  "chroma:down": "docker rm -f chroma-rag",
  "chroma:inspect": "tsx --env-file=.env src/rag/inspect-chroma.ts"
},
```

- [ ] **Step 3: 验证后端测试仍通过**

```bash
npm test
```

Expected: 16 个测试全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove CLI entry point (src/index.ts)"
```

---

## Task 8: 更新后端路由 + 服务器启动

**Files:**
- Modify: `src/routes/chat.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: 重写 routes/chat.ts**

将 `src/routes/chat.ts` 的完整内容替换为：

```typescript
/**
 * HTTP 路由定义 — API 的"门面"
 *
 * Phase 3 变更：
 * - POST /chat 不再需要 sessionId，使用后端唯一 session
 * - 新增 GET /history 加载最近消息
 * - 新增 POST /reset 重置对话
 * - chat 成功后在同一事务中持久化 session + messages
 */
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { chat } from '../services/chat-service.js';
import * as sessionManager from '../services/session-manager.js';
import * as messageRepo from '../db/message-repo.js';
import { runTransaction } from '../db/database.js';

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
            id: randomUUID(),
            role: 'user',
            content: message,
            scenario: null,
            timestamp: now - 1,
          });
          messageRepo.addMessage({
            id: randomUUID(),
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
```

**关键实现说明：**
- user 消息的 `timestamp` 比 assistant 小 1ms，保证同一轮中 user 在前
- `runTransaction` 确保 session save + message writes 的原子性
- 失败路径不执行任何持久化（spec §7.1）

- [ ] **Step 2: 更新 server.ts**

将 `src/server.ts` 的完整内容替换为：

```typescript
/**
 * HTTP 服务启动入口
 *
 * Phase 3 变更：
 * - 启动时初始化 SQLite 数据库
 * - 启动时从 DB 加载（或创建）session
 * - 移除 session 清理定时器（单用户永久 session）
 * - 关闭时释放 DB 连接
 */
import { buildApp } from './app.js';
import { preloadRagKnowledge } from './services/chat-service.js';
import { initDefaultSession } from './services/session-manager.js';
import { initDb, closeDb } from './db/database.js';
import { SERVER_PORT } from './config.js';

async function start() {
  const app = buildApp();

  console.log('🎓 English Tutor Agent API — initializing...');

  initDb();
  initDefaultSession();

  await preloadRagKnowledge().catch(() => {
    /* 错误已在 chat-service 内打印 */
  });

  try {
    const address = await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
    console.log(`🚀 Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
```

- [ ] **Step 3: 运行后端测试确认无回归**

```bash
npm test
```

Expected: 16 个测试全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat.ts src/server.ts
git commit -m "feat: add history/reset endpoints, wire SQLite persistence into server lifecycle"
```

---

## Task 9: 更新前端类型 + API 层

**Files:**
- Modify: `web/src/types/chat.ts`
- Modify: `web/src/api/chat.ts`

- [ ] **Step 1: 更新 types/chat.ts**

将 `web/src/types/chat.ts` 的完整内容替换为：

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  scenario?: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: string;
  scenario: string;
}

export interface HistoryResponse {
  messages: Message[];
}

export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}
```

变更：`ChatRequest` 移除 `sessionId`，`ChatResponse` 移除 `sessionId`，新增 `HistoryResponse`。

- [ ] **Step 2: 更新 api/chat.ts**

将 `web/src/api/chat.ts` 的完整内容替换为：

```typescript
import type { ChatRequest, ChatResponse, HistoryResponse, ErrorResponse } from '../types/chat';

const API_BASE = '/api';

export class ChatApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'ChatApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function sendChatMessage(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }

  return res.json();
}

/** 加载最近的历史消息 */
export async function fetchHistory(): Promise<HistoryResponse> {
  const res = await fetch(`${API_BASE}/history`);

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }

  return res.json();
}

/** 重置对话，清空所有记忆 */
export async function resetConversation(): Promise<void> {
  const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }
}

export async function checkHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) {
    throw new ChatApiError('Health check failed', 'HEALTH_CHECK_FAILED', res.status);
  }
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/types/chat.ts web/src/api/chat.ts
git commit -m "feat: update frontend types and API layer for persistence"
```

---

## Task 10: 更新前端 useConversation hook + 测试

**Files:**
- Modify: `web/src/hooks/__tests__/useConversation.test.ts`
- Modify: `web/src/hooks/useConversation.ts`

- [ ] **Step 1: 重写 useConversation 测试**

将 `web/src/hooks/__tests__/useConversation.test.ts` 的完整内容替换为：

```typescript
/**
 * useConversation 单元测试：
 * - 基础：消息发送与回复追加
 * - 持久化：挂载时加载历史消息
 * - 重置：resetConversation 清空消息
 * - 错误：API 失败与网络异常
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversation } from '@/hooks/useConversation';
import * as chatApi from '@/api/chat';

vi.mock('@/api/chat', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/chat')>();
  return {
    ...mod,
    sendChatMessage: vi.fn(),
    fetchHistory: vi.fn(),
    resetConversation: vi.fn(),
  };
});
const mockedSendChatMessage = vi.mocked(chatApi.sendChatMessage);
const mockedFetchHistory = vi.mocked(chatApi.fetchHistory);
const mockedResetConversation = vi.mocked(chatApi.resetConversation);

beforeEach(() => {
  vi.resetAllMocks();
  mockedFetchHistory.mockResolvedValue({ messages: [] });
  vi.stubGlobal('crypto', {
    randomUUID: vi
      .fn()
      .mockReturnValueOnce('user-msg-1')
      .mockReturnValueOnce('assistant-msg-1')
      .mockReturnValueOnce('user-msg-2')
      .mockReturnValueOnce('assistant-msg-2'),
  });
});

describe('useConversation', () => {
  it('starts with empty state and loads history on mount', async () => {
    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalledOnce();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('populates messages from history API on mount', async () => {
    mockedFetchHistory.mockResolvedValueOnce({
      messages: [
        { id: 'h-1', role: 'user', content: 'hi', timestamp: 1000 },
        { id: 'h-2', role: 'assistant', content: 'hello', timestamp: 2000, scenario: 'greeting' },
      ],
    });

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages[0].content).toBe('hi');
    expect(result.current.messages[1].content).toBe('hello');
  });

  it('sends a message and receives a reply (no sessionId)', async () => {
    mockedSendChatMessage.mockResolvedValueOnce({
      reply: 'Hello! How can I help?',
      scenario: 'greeting',
    });

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'Hi' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello! How can I help?' });

    expect(mockedSendChatMessage).toHaveBeenCalledWith({ message: 'Hi' });
  });

  it('sets error on API failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Server error', 'LLM_ERROR', 500)
    );

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('sets network error message on fetch failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('网络连接失败，请检查网络后重试');
  });

  it('clears error with clearError', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Error', 'LLM_ERROR', 500)
    );

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('ignores empty or whitespace-only messages', async () => {
    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(result.current.messages).toEqual([]);
    expect(mockedSendChatMessage).not.toHaveBeenCalled();
  });

  it('resetConversation clears messages and calls API', async () => {
    mockedFetchHistory.mockResolvedValueOnce({
      messages: [
        { id: 'h-1', role: 'user', content: 'hi', timestamp: 1000 },
      ],
    });
    mockedResetConversation.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      await result.current.resetConversation();
    });

    expect(mockedResetConversation).toHaveBeenCalledOnce();
    expect(result.current.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/hooks/__tests__/useConversation.test.ts
```

Expected: FAIL — `useConversation` 还没有 `resetConversation` 导出，也没有 history 加载逻辑。

- [ ] **Step 3: 重写 useConversation.ts**

将 `web/src/hooks/useConversation.ts` 的完整内容替换为：

```typescript
import { useState, useCallback, useEffect } from 'react';
import type { Message } from '../types/chat';
import { sendChatMessage, fetchHistory, resetConversation as apiReset, ChatApiError } from '../api/chat';

function newMessageId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface UseConversationReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
  resetConversation: () => Promise<void>;
}

/**
 * 管理对话：挂载时从后端加载历史消息，发送消息时追加到列表，
 * 支持重置对话清空记忆。
 */
export function useConversation(): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory()
      .then((res) => setMessages(res.messages))
      .catch(() => { /* 历史加载失败静默处理，用户可正常开始新对话 */ });
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: newMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendChatMessage({ message: trimmed });

      const assistantMessage: Message = {
        id: newMessageId(),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
        scenario: response.scenario,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      if (err instanceof ChatApiError) {
        setError(err.message);
      } else {
        setError('网络连接失败，请检查网络后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const clearError = useCallback(() => setError(null), []);

  const handleReset = useCallback(async () => {
    try {
      await apiReset();
      setMessages([]);
      setError(null);
    } catch {
      setError('重置失败，请稍后重试');
    }
  }, []);

  return { messages, isLoading, error, sendMessage, clearError, resetConversation: handleReset };
}
```

- [ ] **Step 4: 运行 useConversation 测试确认通过**

```bash
cd web && npx vitest run src/hooks/__tests__/useConversation.test.ts
```

Expected: 8 个测试全部 PASS。

- [ ] **Step 5: 运行全部前端测试确认无回归**

```bash
cd web && npm run test
```

Expected: 可能有部分其他测试因类型变更失败（如 `chat.test.ts` 中的 `sessionId` 相关断言）。如果有失败，在下一个 step 修复。

- [ ] **Step 6: 修复 chat.test.ts（移除 sessionId 相关测试）**

`web/src/api/__tests__/chat.test.ts` 需要以下修改：

1. **删除** 整个 `'includes sessionId in request when provided'` 测试用例（第 36-47 行）——`ChatRequest` 不再有 `sessionId` 字段，这个测试不再有意义。

2. **修改** `'sends request and returns response on success'` 测试：
   - `mockResponse` 中移除 `sessionId: 'sid-1'` 字段
   - 更新为 `{ reply: 'Hello!', scenario: 'greeting' }`

3. **修改** `'throws ChatApiError on HTTP error'` 测试：
   - 所有 `sendChatMessage({ message: 'Hi', sessionId: 'bad-id' })` 改为 `sendChatMessage({ message: 'Hi' })`
   - 错误场景改为 LLM_ERROR 500（SESSION_NOT_FOUND 不再存在）

4. **新增** `fetchHistory` 和 `resetConversation` 的测试（从 `@/api/chat` 导入）。

同时更新 `web/src/components/__tests__/ChatWindow.test.tsx`：所有 `<ChatWindow>` 渲染处添加 `onReset={vi.fn()}` prop（3 处），否则会因缺少必需 prop 而报 TypeScript 错误。

修复后运行：

```bash
cd web && npm run test
```

Expected: 全部前端测试 PASS。

- [ ] **Step 7: Commit**

```bash
git add web/src/hooks/useConversation.ts web/src/hooks/__tests__/useConversation.test.ts
git add web/src/api/__tests__/chat.test.ts web/src/components/__tests__/ChatWindow.test.tsx
git commit -m "feat: add history loading and reset to useConversation hook"
```

---

## Task 11: ChatWindow 添加"重新开始"按钮

**Files:**
- Modify: `web/src/components/ChatWindow.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 更新 ChatWindow 接受 onReset prop**

将 `web/src/components/ChatWindow.tsx` 的完整内容替换为：

```tsx
import type { Message } from '../types/chat';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onDismissError: () => void;
  onReset: () => void;
}

/** 聊天主容器：顶部标题栏（含重新开始）+ 可选错误条 + 消息列表 + 底部输入。 */
export function ChatWindow({
  messages,
  isLoading,
  error,
  onSend,
  onDismissError,
  onReset,
}: ChatWindowProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-medium">English Tutor</h1>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          重新开始
        </button>
      </div>
      {error && (
        <div className="flex shrink-0 items-center justify-between bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="ml-2 hover:opacity-70"
            aria-label="✕"
          >
            ✕
          </button>
        </div>
      )}
      <MessageList messages={messages} isLoading={isLoading} />
      <ChatInput isLoading={isLoading} onSend={onSend} />
    </div>
  );
}
```

按钮暂时放在顶部标题栏右侧。具体位置留到视觉验收时微调。

- [ ] **Step 2: 更新 App.tsx 传递 onReset**

读取当前 `web/src/App.tsx`，在 `<ChatWindow>` 上添加 `onReset={resetConversation}`。从 `useConversation()` 解构中新增 `resetConversation`：

```tsx
const { messages, isLoading, error, sendMessage, clearError, resetConversation } = useConversation();
```

```tsx
<ChatWindow
  messages={messages}
  isLoading={isLoading}
  error={error}
  onSend={sendMessage}
  onDismissError={clearError}
  onReset={resetConversation}
/>
```

- [ ] **Step 3: 修复 ChatWindow 测试**

`web/src/components/__tests__/ChatWindow.test.tsx` 中所有 `<ChatWindow>` 渲染处（3 处）已在 Task 10 Step 6 中添加了 `onReset={vi.fn()}`。如果 Task 10 Step 6 未处理，在此处补上。确保现有测试通过。

- [ ] **Step 4: 运行全部前端测试**

```bash
cd web && npm run test
```

Expected: 全部前端测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatWindow.tsx web/src/App.tsx
git add web/src/components/__tests__/ChatWindow.test.tsx
git commit -m "feat: add reset conversation button to ChatWindow header"
```

---

## Task 12: 全链路验证

- [ ] **Step 1: 运行全部后端测试**

```bash
npm test
```

Expected: 16 个测试全部 PASS。

- [ ] **Step 2: 运行全部前端测试**

```bash
cd web && npm run test
```

Expected: 全部前端测试 PASS。

- [ ] **Step 3: 启动后端并验证 API**

终端 1:

```bash
npm run dev:server
```

Expected: 控制台输出 `[Session] 已创建新会话`（首次启动）或 `[Session] 已从数据库恢复会话`（非首次），`Server listening at ...`。

确认 `data/english-tutor.db` 文件已自动创建。

- [ ] **Step 4: 在浏览器中验证完整流程**

终端 2:

```bash
cd web && npm run dev
```

打开 `http://localhost:5173`，依次验证：

1. **首次访问** — 页面空白（无历史消息），正常
2. **发送消息** — 输入 "how to say 你好"，等待回复，确认 user + assistant 消息显示
3. **刷新页面** — 刷新后应看到刚才的消息（从 `GET /api/history` 加载）
4. **重新开始** — 点击"重新开始"按钮，消息应清空
5. **刷新确认** — 再次刷新，确认消息仍为空（后端 DB 已清空）
6. **服务器重启** — 发送几条消息，停止后端（Ctrl+C），重新启动，刷新前端，消息应恢复

- [ ] **Step 5: 最终 commit（如有视觉微调）**

若视觉验收中调整了"重新开始"按钮的位置/样式：

```bash
cd web && npm run test
npm test
git add -A
git commit -m "style: fine-tune reset button placement"
```

若无需调整则跳过此步。
