# English Tutor Agent — Web API 架构设计

> **日期**: 2026-03-26
> **状态**: 已确认，待实施
> **范围**: 将 CLI 应用改造为 Fastify HTTP API，支持多用户会话隔离

## 1. 背景与目标

当前 English Tutor Agent 是命令行交互应用，用户只能在终端里聊天。对话状态（`conversationHistory`、`summaryContext`）存储在 `chat.ts` 的模块级变量中，仅支持单用户。

**目标**: 改造为 Web API，前端可以通过 HTTP 请求调用，同时保留 CLI 入口。

**约束**:
- 个人项目起步，预留小团队扩展能力
- 暂无前端，先提供标准 REST API（curl / Postman 测试），未来对接 React
- 先实现 Request/Response 模式，预留 SSE 流式输出扩展点
- 使用 Fastify 框架

## 2. 架构方案

选择 **职责拆分（Service Layer 重构）** 方案：

- 将 `chat.ts` 拆成无状态的 `ChatService` + 独立的 `SessionManager`
- Fastify 只做 HTTP 协议转换
- 现有模块（classifier、prompts、rag、tools）不改动

**否决方案**: 最小包装（薄 API 壳）——保留模块级变量 + 请求前后"换入换出"的方式在并发场景下有竞态风险，两个用户同时发消息会导致对话历史互相污染。

## 3. 目录结构

```
src/
├── index.ts                  # CLI 入口（保留，复用 ChatService）
├── server.ts                 # Fastify HTTP 入口（新）
├── app.ts                    # Fastify 实例创建与插件注册（新）
│
├── routes/
│   └── chat.ts               # POST /chat 路由定义（新）
│
├── services/
│   ├── chat-service.ts       # 从 chat.ts 重构：无状态业务逻辑（新）
│   └── session-manager.ts    # 会话状态管理（新）
│
├── types/
│   └── session.ts            # Session 接口定义（新）
│
├── classifier.ts             # 不改
├── client.ts                 # 不改
├── config.ts                 # 新增 SERVER_PORT、SESSION_TTL 等配置项
│
├── prompts/                  # 不改
│   ├── base.ts
│   ├── vocabulary.ts
│   ├── grammar.ts
│   ├── expression.ts
│   ├── offTopic.ts
│   └── rag.ts
│
├── rag/                      # 不改
│   ├── chroma-store.ts
│   ├── embedding.ts
│   ├── inspect-chroma.ts
│   └── knowledge.ts
│
└── tools/                    # 不改
    └── dictionary.ts
```

### 模块职责与依赖方向

| 模块 | 职责 | 依赖方向 |
|------|------|----------|
| `server.ts` | 启动进程、监听端口 | → `app.ts` |
| `app.ts` | 创建 Fastify 实例、注册 CORS/错误处理/路由 | → `routes/*` |
| `routes/chat.ts` | HTTP 协议转换（解析请求、构造响应） | → `services/*` |
| `services/chat-service.ts` | 纯业务逻辑（分类、组装 prompt、tool loop） | → `classifier`, `prompts`, `rag`, `tools` |
| `services/session-manager.ts` | 会话 CRUD + 过期清理 | → `types/session` |
| `types/session.ts` | 数据类型定义 | 无依赖 |

**关键约束**: 依赖只能向下流动（`routes → services → 现有模块`），`services` 不知道 Fastify 的存在。

## 4. Session 数据模型

### 接口定义

```typescript
interface Session {
  id: string;                              // 唯一标识，如 "s_abc123"
  history: ChatCompletionMessageParam[];   // 对话历史（原 conversationHistory）
  summary: string;                         // 历史摘要（原 summaryContext）
  createdAt: number;                       // 创建时间戳
  lastActiveAt: number;                    // 最后活跃时间戳
}
```

### SessionManager

```
SessionManager
  ├── create()              → 创建新 Session，返回 sessionId
  ├── get(id)               → 获取已有 Session，不存在返回 undefined
  ├── touch(session)        → 更新 session.lastActiveAt 为当前时间
  ├── cleanup()             → 清理超时 Session
  └── 内部存储：Map<string, Session>
```

**路由层的会话解析逻辑**（在 `routes/chat.ts` 中，不在 SessionManager 中）：

1. `sessionId` 缺省或为空字符串 → 调用 `create()`，新建会话
2. `sessionId` 非空 → 调用 `get(id)`：
   - 找到 → 继续处理
   - 找不到 → 返回 404 `SESSION_NOT_FOUND`（不自动新建）

### lastActiveAt 更新时机

每次 `ChatService.chat()` 成功返回后，由路由层调用 `sessionManager.touch(session)` 更新 `lastActiveAt`。这样 TTL 计时从最后一次成功对话算起，而非从创建时间算起。

### 过期清理

- `SESSION_TTL` = 30 分钟（可在 config.ts 配置），从 `lastActiveAt` 算起
- `setInterval` 每 5 分钟扫描一次，删除 `lastActiveAt` 超时的 Session

> **TODO**: 未来扩展小团队时，将 SessionManager 内部从 `Map` 换成 Redis，接口不变，上下游无需改动。

## 5. ChatService 重构

核心思路：逻辑全部保留，将"读写全局变量"改为"读写传入的 Session 参数"。

### 改造对照表

| chat.ts 现有 | 改造方式 |
|---|---|
| `chat(userMessage)` | → `chat(session, userMessage)` |
| `compressHistory()` | → `compressHistory(session)` 操作 session.history / session.summary |
| `buildSystemPrompt(...)` | 不变（已是纯函数） |
| `runToolLoop(...)` | 不变（已是纯函数） |
| `generateSummary(...)` | 不变（已是纯函数） |
| `preloadRagKnowledge()` | 不变（Chroma 是全局共享资源） |
| 模块级 `conversationHistory` | 删除 → `session.history` |
| 模块级 `summaryContext` | 删除 → `session.summary` |
| 模块级 `chromaReady` / `chromaInitPromise` | 保留为模块级（全局共享） |
| `preloadRagKnowledge()` 导出位置 | 保留在 `chat-service.ts` 中导出，`server.ts` 和 `index.ts` 均从此处导入 |

### ChatService 核心签名

```typescript
interface ChatResult {
  reply: string;
  scenario: Scenario;
}

export async function chat(session: Session, userMessage: string): Promise<ChatResult>
```

返回结构化结果而非裸字符串，这样路由层可以直接将 `scenario` 传给前端，无需重复调用 `classify()`。

内部流程与现有 `chat()` 完全一致：`classify → compressHistory(session) → buildSystemPrompt → runToolLoop → 更新 session.history`，最后返回 `{ reply, scenario }`。

## 6. API 路由与请求/响应契约

### 第一期路由

| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/chat` | 发送消息，获取 AI 回复 |
| `GET` | `/health` | 健康检查，返回 `{ "ok": true }` |

### 后续扩展（TODO）

| 方法 | 路径 | 功能 |
|------|------|------|
| `DELETE` | `/chat/:sessionId` | 清除指定会话 |
| `GET` | `/chat/:sessionId/stream` | SSE 流式输出 |

### POST /chat 契约

**Request:**

```json
{
  "message": "What does 'brilliant' mean?",
  "sessionId": "s_abc123"
}
```

`sessionId` 可选。不传或传空字符串 `""` 均视为创建新会话。

**Response（成功 200）:**

```json
{
  "reply": "The word 'brilliant' has several meanings...",
  "sessionId": "s_abc123",
  "scenario": "VOCABULARY"
}
```

**Response（错误）:**

```json
{
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND",
  "statusCode": 404
}
```

### 错误码

| HTTP 状态码 | code | 场景 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 缺少 message 或格式不对 |
| 404 | `SESSION_NOT_FOUND` | sessionId 已过期或不存在 |
| 500 | `LLM_ERROR` | 调用 Moonshot API 失败 |
| 500 | `INTERNAL_ERROR` | 其他未预期错误（包括 classify 阶段的 LLM 调用失败） |

### 请求校验（Fastify JSON Schema）

```typescript
{
  schema: {
    body: {
      type: 'object',
      required: ['message'],
      properties: {
        message:   { type: 'string', minLength: 1, maxLength: 5000 },
        sessionId: { type: 'string' }
      }
    }
  }
}
```

## 7. Fastify 应用层

### app.ts 职责

1. 创建 Fastify 实例（带内置 pino 日志）
2. 注册 `@fastify/cors`（开发阶段 `origin: true`，TODO: 生产环境限制域名）
3. 注册全局错误处理钩子
4. 注册路由
5. 导出 app 实例

### server.ts 启动流程

1. 导入 app
2. `preloadRagKnowledge()`（复用现有 Chroma 预加载）
3. `app.listen({ port: SERVER_PORT, host: '0.0.0.0' })`
4. 优雅关闭：监听 `SIGINT` / `SIGTERM` → `app.close()`

### index.ts CLI 入口改造

```
改造前：import { chat } from './chat.js'  →  chat(input)
改造后：import { chat } from './services/chat-service.js'  →  chat(session, input)
```

创建一个本地 Session 对象，行为与改造前完全一致。

### package.json scripts

```json
{
  "dev:cli":    "tsx --env-file=.env src/index.ts",
  "dev:server": "tsx --env-file=.env src/server.ts"
}
```

原 `dev` 改名为 `dev:cli`，新增 `dev:server`。

### 新增依赖

| 包 | 用途 |
|---|---|
| `fastify` | HTTP 框架 |
| `@fastify/cors` | CORS 支持 |

## 8. 未来扩展 TODO 汇总

- [ ] SessionManager 从内存 Map 换成 Redis
- [ ] SSE 流式输出（`GET /chat/:sessionId/stream`）
- [ ] `DELETE /chat/:sessionId` 清除会话
- [ ] CORS 生产环境限制具体域名
- [ ] 认证鉴权（API Key 或 JWT）
- [ ] 请求限流
