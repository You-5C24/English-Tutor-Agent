# 对话记忆持久化设计 — Phase 3

> English Tutor Agent Phase 3 设计文档
> 日期：2026-03-31
> 前置：[Phase 2 Markdown 渲染设计](./2026-03-30-markdown-rendering-design.md)

## 1. 背景与目标

Phase 2 已完成 Markdown 渲染，对话可读性大幅提升。但当前对话状态完全存在内存中——浏览器刷新丢失 UI 消息，服务器重启丢失全部 session。用户每次打开页面都是"陌生人"，Agent 不记得之前教过什么。

**Phase 3 目标：** 实现单用户连续记忆——Agent 跨浏览器刷新和服务器重启后仍记住之前的对话上下文，用户打开页面即可继续上次的对话。同时提供"重新开始"功能，让用户可以主动清除记忆。

**非目标（Phase 3 不做）：**
- 多用户认证与多租户隔离
- 多会话列表（对话切换/新建/删除）
- 完整历史无限回溯（不存所有消息给用户看）
- 前端 localStorage 存储（由后端统一管理持久化）
- CLI 入口维护（本期移除 CLI，聚焦 Web）

## 2. 核心设计决策

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 记忆模式 | 单用户连续记忆 | 产品定位是"一对一私教"，非多会话工具 |
| LLM 上下文策略 | 摘要 + 最近 N 轮 | 完整历史会导致 token 爆炸；纯摘要用户无法回看 |
| 存储引擎 | SQLite（`better-sqlite3`） | 零部署依赖，标准 SQL 可迁移，学习价值高 |
| Session 识别 | 后端固定唯一 session | 单用户无需前端存 sessionId，跨浏览器/设备都能继续 |
| 前端显示量 | 最近 30 条消息 | 约 15 轮对话，足够回看上下文又不影响加载速度 |
| 重新开始 | 本期实现 | 持久化的必要配套——用户需要主动清除记忆的出口 |

### 2.1 LLM 上下文与用户展示的解耦

Phase 3 的核心架构洞察：**LLM 看到的 ≠ 用户看到的**。

| 关注点 | 存什么 | 谁消费 |
|--------|--------|--------|
| LLM 上下文 | `summary` + 压缩后的 `history`（约 5 轮） | 发给模型，控制 token |
| 用户展示 | 最近 30 条原始消息 | 前端加载显示 |

后端 `compressHistory` 触发后会裁剪 `session.history`，如果前端直接用 history 做展示，消息会在压缩时"消失"。因此必须分开存储：`sessions` 表存 LLM 上下文，`messages` 表存展示消息。

## 3. 数据模型（SQLite 表结构）

### 3.1 sessions 表 — 会话元数据（永远只有一行）

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PRIMARY KEY | 固定值 `'default'`，单用户只有一个 session |
| `summary` | TEXT | 压缩后的对话摘要，发给 LLM 作为长期记忆 |
| `history` | TEXT | JSON 序列化的 `ChatCompletionMessageParam[]`，当前发给 LLM 的最近几轮 |
| `created_at` | INTEGER | 创建时间戳（epoch ms） |
| `last_active_at` | INTEGER | 最后活跃时间戳 |

`history` 列存 JSON 字符串而非拆成多行——它是发给 OpenAI SDK 的原始数据结构，保持序列化/反序列化的简单性。

### 3.2 messages 表 — 用户可见的对话记录

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PRIMARY KEY | 消息 UUID |
| `role` | TEXT NOT NULL | `'user'` 或 `'assistant'` |
| `content` | TEXT NOT NULL | 消息内容 |
| `scenario` | TEXT | assistant 消息的场景分类（如 `VOCABULARY`） |
| `timestamp` | INTEGER NOT NULL | 创建时间戳（epoch ms） |

索引：`timestamp` 上建索引，加速 `ORDER BY timestamp DESC LIMIT 30` 查询。

不加 `session_id` 外键——单用户单 session，无必要。未来多用户时再加。

## 4. 后端架构

### 4.1 新增与改动文件

```
src/
├── db/                          ← 🆕 持久化层
│   ├── database.ts              ← SQLite 连接单例 + 建表
│   ├── session-repo.ts          ← sessions 表 CRUD
│   └── message-repo.ts          ← messages 表 CRUD
├── services/
│   └── session-manager.ts       ← ✏️ 重构为单 session 持久化管理器
├── routes/
│   └── chat.ts                  ← ✏️ 新增 GET /history、POST /reset；简化 session 解析
├── config.ts                    ← ✏️ 新增 DB_PATH 等配置
├── server.ts                    ← ✏️ 启动时调用 DB 初始化
└── index.ts                     ← 🗑️ 删除 CLI 入口
```

不改动的文件：`chat-service.ts`、`classifier.ts`、`client.ts`、`types/session.ts`、`prompts/*`、`rag/*`、`tools/*`。

### 4.2 各模块职责边界

| 模块 | 只做什么 | 不做什么 |
|------|---------|---------|
| `database.ts` | 创建 SQLite 连接、建表、暴露连接单例 | 不含任何业务查询 |
| `session-repo.ts` | sessions 表的读、写、重置 | 不管 messages |
| `message-repo.ts` | messages 表的追加、查询、清空 | 不管 sessions |
| `session-manager.ts` | 管理内存中的 Session 单例，启动时从 DB 加载，暴露保存/重置 | 不直接写 SQL（委托给 repo） |
| `chat-service.ts` | LLM 调用、分类、压缩、prompt 组装 | 不感知持久化（不改） |
| `chat.ts`（路由） | HTTP 请求/响应、编排 session-manager 和 message-repo | 不含 LLM 逻辑 |

### 4.3 session-manager 重构

从"多 session 的 Map 管理器"重构为"单 session 的持久化管理器"：

**移除：**
- 内存 `Map`、`generateId()`
- `create()`、`get(id)`、`touch()`
- `cleanup()`、`startCleanupTimer()`、`stopCleanupTimer()`、`size()`
- TTL 相关逻辑

**新增：**
| 方法 | 职责 |
|------|------|
| `initDefaultSession()` | 从 DB 加载 session；若 DB 为空则创建并存入 |
| `getDefaultSession()` | 返回内存中的唯一 session |
| `save()` | 将当前 session 状态（history + summary + lastActiveAt）写入 DB |
| `reset()` | 清空 summary + history，重置时间戳，写入 DB |

### 4.4 核心数据流

**启动流程：**
```
server.ts: start()
  → initDb()                            // 创建/打开 SQLite，建表（IF NOT EXISTS）
  → sessionManager.initDefaultSession()  // 从 DB 加载（或新建空 session）
  → preloadRagKnowledge()               // 同之前
  → app.listen()                        // 同之前
```
不再调用 `startCleanupTimer()`——单用户永久 session 无 TTL 过期。

**对话流程（`POST /api/chat`）：**
```
前端: POST /api/chat { message: "how to say 你好" }

路由层:
  1. session = sessionManager.getDefaultSession()
  2. result = await chat(session, message)
  3. sessionManager.save()                        // history + summary → SQLite
  4. messageRepo.addMessage(userMsg)              // 追加到 messages 表
  5. messageRepo.addMessage(assistantMsg)
  6. return { reply, scenario }
```

步骤 3-5（save + 两次 addMessage）应在同一个 SQLite 事务中执行，确保不会出现"session 已更新但 messages 只写了一半"的中间状态。

**历史加载流程（`GET /api/history`）：**
```
前端: 页面加载 → GET /api/history

路由层:
  1. messages = messageRepo.getRecentMessages(30)  // ORDER BY timestamp ASC（正序，上旧下新）
  2. return { messages }
```

API 返回时间正序（旧消息在前，新消息在后），前端无需反转，直接渲染即可。SQL 实现方式：子查询 DESC LIMIT 30 取最近 30 条，外层再 ASC 排序。

**重新开始流程（`POST /api/reset`）：**
```
前端: 用户点击"重新开始" → POST /api/reset

路由层:
  1. messageRepo.deleteAll()              // 清空 messages 表
  2. sessionManager.reset()               // 清空 summary + history，写入 DB
  3. return { ok: true }
```

### 4.5 API 接口变更

| 端点 | 变更 | 请求 | 响应 |
|------|------|------|------|
| `POST /api/chat` | 简化 | `{ message: string }` — 移除 `sessionId` | `{ reply: string, scenario: string }` — 移除 `sessionId` |
| `GET /api/history` | 🆕 | 无请求体 | `{ messages: Message[] }` — 最近 30 条 |
| `POST /api/reset` | 🆕 | 无请求体 | `{ ok: true }` |
| `GET /api/health` | 不变 | — | `{ ok: true }` |

### 4.6 新增依赖

| 包 | 用途 |
|----|------|
| `better-sqlite3` | SQLite 驱动（同步 API，无需处理 Promise） |
| `@types/better-sqlite3` | TypeScript 类型定义（devDependency） |

### 4.7 配置新增

`config.ts` 新增：

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `DB_PATH` | `'data/english-tutor.db'` | SQLite 数据库文件路径，通过 `path.resolve(__dirname, '..', DB_PATH)` 确保始终相对于项目根目录解析，不受 `process.cwd()` 影响 |
| `DISPLAY_MESSAGE_LIMIT` | `30` | 前端历史消息加载条数 |

移除：`SESSION_TTL`、`SESSION_CLEANUP_INTERVAL`（无 TTL 机制）。

`data/` 目录加入 `.gitignore`（数据库文件不提交）。

## 5. 前端改动

### 5.1 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/src/types/chat.ts` | ✏️ | `ChatRequest` 移除 `sessionId`；`ChatResponse` 移除 `sessionId`；新增 `HistoryResponse` |
| `web/src/api/chat.ts` | ✏️ | 新增 `fetchHistory()`、`resetConversation()`；`sendChatMessage()` 不再发 `sessionId` |
| `web/src/hooks/useConversation.ts` | ✏️ | 挂载时加载历史；移除 `sessionId` 状态；新增 `resetConversation` 方法 |
| `web/src/components/ChatWindow.tsx` | ✏️ | 添加"重新开始"按钮（具体位置留到实现时看视觉效果再定） |

不改动：`MessageBubble.tsx`、`MessageList.tsx`、`ChatInput.tsx`、`App.tsx`、`App.css`。

### 5.2 useConversation 改造

**移除：**
- `sessionId` 状态
- `sendChatMessage` 调用中的 `sessionId` 参数
- `SESSION_NOT_FOUND` 错误处理（不再有 session 过期的概念）

**新增：**
- 挂载时调用 `GET /api/history` 加载历史消息
- `resetConversation()` 方法：调用 `POST /api/reset` → 清空本地 `messages` 状态
- 历史加载中的 loading 状态（可选，防止空白闪烁）

### 5.3 类型变更

```
ChatRequest:  { message: string }                    // 移除 sessionId
ChatResponse: { reply: string, scenario: string }    // 移除 sessionId
HistoryResponse: { messages: Message[] }             // 🆕
```

`HistoryResponse.messages` 每项字段与现有前端 `Message` 类型对齐：`id: string`、`role: 'user' | 'assistant'`、`content: string`、`timestamp: number`、`scenario?: string`（assistant 消息有值，user 消息为 null）。

## 6. CLI 清理

移除 CLI 相关代码：

| 文件 | 操作 |
|------|------|
| `src/index.ts` | 🗑️ 删除 |
| `package.json` | ✏️ 移除 `dev:cli` script |

## 7. 失败路径与错误处理

### 7.1 对话失败时的持久化策略

`POST /api/chat` 的路由层编排中，**仅在 `chat()` 成功返回后才执行持久化**（save session + 写 messages）。如果 `chat()` 抛出异常（LLM 调用失败、网络超时等），不执行任何 DB 写入——内存中的 session 对象可能已被 `chat-service` 部分修改（如 `compressHistory` 已执行），但由于未调用 `save()`，DB 中的状态保持上一次成功对话的快照，不会出现"DB 与内存不一致导致重复/丢失消息"的问题。

下次成功的对话会将内存中的最新状态（含已压缩的 history）正常写入 DB，自然恢复一致性。

### 7.2 错误场景处理

| 场景 | 处理方式 |
|------|---------|
| SQLite 文件不存在（首次启动） | `initDb()` 自动创建文件 + 建表 |
| SQLite 读写失败 | 抛出异常，Fastify 全局 errorHandler 返回 500 |
| `GET /api/history` 无数据 | 返回 `{ messages: [] }`，前端显示空对话 |
| `POST /api/reset` 时 DB 为空 | 正常执行（DELETE 空表不报错），返回 `{ ok: true }` |
| `data/` 目录不存在 | `initDb()` 中自动创建目录（`mkdirSync recursive`） |

## 8. 测试策略

### 8.1 后端测试

| 测试范围 | 测试内容 |
|----------|----------|
| `session-repo` | 加载空 DB → 返回 null；保存后再加载 → 数据一致；重置后 → summary/history 为空 |
| `message-repo` | 追加消息 → 查询返回；超过 30 条 → 只返回最近 30 条；清空后 → 返回空数组 |
| `session-manager` | 初始化空 DB → 创建默认 session；初始化已有 DB → 恢复 session 状态；save → DB 数据更新；reset → session 和 DB 均清空 |
| `POST /api/chat` | 发送消息 → 收到回复；重启后发送 → session 记忆延续 |
| `GET /api/history` | 空对话 → 空数组；有消息 → 按时间正序（上旧下新）返回；超过 30 条 → 只返回最近 30 条 |
| `POST /api/reset` | 重置后 → history 空、session summary 空 |

### 8.2 前端测试

| 测试范围 | 测试内容 |
|----------|----------|
| `useConversation` | 挂载时调用 history API → messages 填充；发送消息 → 追加 user + assistant；resetConversation → messages 清空 |

### 8.3 不测的

- `better-sqlite3` 内部的 SQL 执行正确性（库的责任）
- 具体的 CSS 样式（"重新开始"按钮的视觉样式）

## 9. 演进路线（更新）

```
Phase 1（MVP 文字聊天）✅ 已完成
  ├── Phase 2（Markdown 渲染）✅ 已完成
  ├── Phase 3（对话记忆持久化）← 本次实现
  ├── 后端：LangChain 改造
  └── Phase 4（Streaming 响应）
        └── Phase 5（TTS 语音）
              └── Phase 6（数字人）
```

### 9.1 产品化升级路径（备忘）

当项目从个人工具走向产品化时的存储演进：

```
Phase 3（当前）: SQLite 单文件，单用户
    ↓ 产品化
├── PostgreSQL 替代 SQLite（多用户、高并发、云托管）
│   └── 改动范围：仅 src/db/ 内的 3 个文件
│       - database.ts: better-sqlite3 → pg + 连接池
│       - session-repo.ts: 同步 → async，SQL 语法微调
│       - message-repo.ts: 同步 → async，SQL 语法微调
│
├── Redis 缓存层（可选，叠加在 PostgreSQL 之上）
│   └── 热 session 缓存：getDefaultSession() 先查 Redis，miss 再查 PG
│   └── 适用于高频访问场景，单用户阶段不需要
│
└── 用户认证 + 多租户
    └── sessions 表 + messages 表加 user_id 列
    └── session-manager 从单例改为按 user_id 查找
```

Repository 模式保证了上层业务代码（chat-service、routes）无需因存储引擎更换而修改。

如果提前将 repo 接口设计为 `async`，将来换 PostgreSQL 时只需改 repo 内部实现，调用方无需修改。
