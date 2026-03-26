# English Tutor Agent — 从 CLI 到 Web API 的架构改造总结

> **日期**: 2026-03-26
> **相关文档**: [设计 Spec](../specs/2026-03-26-web-api-architecture-design.md) · [实现计划](../plans/2026-03-26-web-api-implementation.md)

---

## 一、改造前：我们有什么

一个 **命令行英语私教 Agent**，用户在终端里输入英文，Agent 调用 LLM 进行教学回复。

```
终端 readline ──→ chat(userMessage) ──→ LLM ──→ 打印回复
                      │
                      ├── classify()         判断意图（词汇/语法/表达/闲聊）
                      ├── buildSystemPrompt() 动态组装 CoT + Few-shot + RAG
                      ├── runToolLoop()       Function Calling（查字典）
                      └── compressHistory()   超过 10 轮时用 LLM 做摘要压缩
```

**核心问题：所有状态都是模块级全局变量。**

```typescript
// chat.ts 中（改造前）
let conversationHistory: ChatCompletionMessageParam[] = [];  // 全局唯一
let summaryContext = '';                                       // 全局唯一
```

这意味着：
- **只能一个人用**——两个人同时聊天，对话历史会互相混在一起
- **无法通过网络访问**——只有坐在这台电脑前才能用
- **无法接入前端**——没有 HTTP 接口

---

## 二、改造目标

把 Agent 变成 Web API，前端（未来的 React 应用）可以通过 HTTP 请求调用：

```
浏览器/curl ──→ POST /chat { message, sessionId } ──→ Fastify ──→ ChatService ──→ LLM
                                                                      │
                                                    ←── { reply, sessionId, scenario }
```

同时保留 CLI 入口，两个入口共享同一套业务逻辑。

---

## 三、架构决策过程

### 3.1 方案对比

| | 方案 A：最小包装 | 方案 B：职责拆分（选定） |
|--|---|---|
| 思路 | 保留 chat.ts 不动，在外面套 Fastify 路由 | 拆成无状态 ChatService + 独立 SessionManager |
| 状态管理 | 请求前从 Map 注入全局变量，请求后存回 | 每个 Session 独立对象，通过参数传入 |
| 并发安全 | ❌ 两个请求同时进来会竞态覆盖 | ✅ 各操作自己的 Session，互不干扰 |
| 可测试性 | 差——依赖全局状态 | 好——ChatService 是纯函数 |
| 扩展性 | 差——加 SSE 需要大改 | 好——路由层切换即可 |
| 工作量 | 小 | 中等（多约 60%） |

**选 B 的原因**：方案 A 的并发竞态不是理论风险——Web API 中两个用户同时发消息几乎必然发生。多花 60% 工作量换来的是一个从根本上正确的架构。

### 3.2 框架选型：Fastify

| 对比维度 | Express | Fastify（选定） |
|----------|---------|---------|
| TypeScript | 需要 `@types/express`，类型经常不准 | 原生内置，一等公民 |
| 请求校验 | 需要额外装 joi/zod | 内置 JSON Schema |
| 日志 | 自己装 morgan/winston | 内置 pino（高性能） |
| 性能 | 基准 | ~2x 快于 Express |
| 生态规模 | 最大 | 够用（官方插件覆盖核心需求） |

---

## 四、核心架构设计

### 4.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  HTTP 层 — routes/chat.ts                                │
│  只做三件事：解析请求 → 调用 Service → 构造响应            │
│  不包含任何业务逻辑                                       │
├─────────────────────────────────────────────────────────┤
│  业务层 — services/                                      │
│                                                         │
│  ChatService (chat-service.ts)                          │
│    无状态纯函数，接收 Session 参数                         │
│    classify → compress → buildPrompt → toolLoop          │
│                                                         │
│  SessionManager (session-manager.ts)                    │
│    会话 CRUD + TTL 过期清理                               │
│    内部用 Map（TODO: 未来换 Redis）                        │
├─────────────────────────────────────────────────────────┤
│  基础层 — 不改动                                         │
│  classifier.ts │ client.ts │ config.ts                  │
│  prompts/*     │ rag/*     │ tools/*                    │
└─────────────────────────────────────────────────────────┘
```

**关键约束：依赖只能向下流动。**
- `routes` 可以调用 `services`，但 `services` 不知道 Fastify 的存在
- 这意味着 `ChatService` 可以同时被 HTTP 路由和 CLI 入口复用

### 4.2 两个入口，一套逻辑

```
npm run dev:cli    →  index.ts   → sessionManager.create() → chat(session, msg)
npm run dev:server →  server.ts  → Fastify → routes/chat.ts → chat(session, msg)
                                                 ↑
                                         同一个 ChatService
```

### 4.3 目录结构

```
src/
├── index.ts                  # CLI 入口
├── server.ts                 # HTTP 入口
├── app.ts                    # Fastify 工厂（创建实例 + 注册插件/路由）
│
├── routes/
│   └── chat.ts               # POST /chat + GET /health
│
├── services/
│   ├── chat-service.ts       # 核心业务（从旧 chat.ts 重构）
│   └── session-manager.ts    # 会话管理（Map 存储 + TTL）
│
├── types/
│   └── session.ts            # Session / ChatResult 类型
│
├── classifier.ts             # 不改
├── client.ts                 # 不改
├── config.ts                 # 新增 SERVER_PORT / SESSION_TTL
├── prompts/                  # 不改
├── rag/                      # 不改
└── tools/                    # 不改
```

---

## 五、关键概念详解

### 5.1 Session — 从全局变量到独立对象

这是整个改造最核心的概念转换。

**改造前**：状态是隐式的模块级全局变量
```typescript
// chat.ts — 进程里只有一份，所有人共享
let conversationHistory = [];
let summaryContext = '';
```

**改造后**：状态是显式的、每用户独立的 Session 对象
```typescript
// types/session.ts
interface Session {
  id: string;                   // "s_a1b2c3..." 唯一标识
  history: Message[];           // 这个用户的对话历史
  summary: string;              // 这个用户的历史摘要
  createdAt: number;
  lastActiveAt: number;         // 最后活跃时间，用于 TTL 过期判断
}
```

函数签名的变化：
```typescript
// 改造前：读写隐式全局变量
export async function chat(userMessage: string): Promise<string>

// 改造后：读写显式传入的 Session
export async function chat(session: Session, userMessage: string): Promise<ChatResult>
```

这个改动看似简单（只是多传了一个参数），但它解决了并发安全的根本问题：每个请求操作自己的 Session 对象，不存在竞态。

### 5.2 SessionManager — 会话的生命周期

```
前端第一次请求（不带 sessionId）
  → SessionManager.create()
  → 返回 sessionId 给前端保存

前端后续请求（带 sessionId）
  → SessionManager.get(id)
  → 找到 → 继续对话
  → 找不到 → 404（可能过期了）

每次对话成功后
  → SessionManager.touch(session)
  → 更新 lastActiveAt，延长过期时间

每 5 分钟自动扫描
  → SessionManager.cleanup()
  → 删除 lastActiveAt 超过 30 分钟的会话
```

**为什么需要过期清理？**
内存 Map 不会自动释放。如果用户打开页面聊了两句就走了，这个 Session 的对话历史会一直占着内存。30 分钟不活跃就清理，防止内存泄漏。

### 5.3 app.ts 与 server.ts 分离 — 可测试性

为什么不把所有代码写在一个 `server.ts` 里？

```typescript
// app.ts — 只负责"组装"，不负责"启动"
export function buildApp() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });
  app.setErrorHandler(/* ... */);
  app.register(chatRoutes);
  return app;  // 返回实例，不调用 listen
}

// server.ts — 负责"启动"
const app = buildApp();
app.listen({ port: 3000 });
```

好处：未来写测试时可以直接模拟请求，不需要占用端口：
```typescript
// 测试代码（未来）
const app = buildApp();
const response = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'hello' } });
assert(response.statusCode === 200);
```

### 5.4 全局错误处理 — 统一错误格式

Fastify 的 `setErrorHandler` 是一个"兜底网"：

```
请求进来
  │
  ├── JSON Schema 校验失败？
  │     → errorHandler 捕获（error.validation 存在）
  │     → 返回 400 { code: "INVALID_REQUEST" }
  │
  ├── 路由 handler 内部 try/catch 捕获？
  │     → 路由自己处理，返回 500 { code: "LLM_ERROR" }
  │     → 不经过 errorHandler
  │
  └── 完全未预期的异常？
        → errorHandler 捕获（兜底）
        → 返回 500 { code: "INTERNAL_ERROR" }
```

这样无论哪种错误，前端都会收到统一的 JSON 格式，不会出现裸 HTML 错误页。

### 5.5 CORS — 为什么需要

浏览器有一个安全策略叫"同源策略"：前端页面（比如 `localhost:5173`）默认不能请求不同端口的 API（比如 `localhost:3000`）。CORS 就是服务端告诉浏览器"我允许这个来源的请求"。

```typescript
app.register(cors, {
  origin: true,    // 开发阶段：允许所有来源
  methods: ['GET', 'POST', 'DELETE'],
});
```

没有这个配置，未来 React 前端调用 API 时浏览器会直接拦截请求。

### 5.6 优雅关闭 — 为什么不能直接 exit

```typescript
const shutdown = async () => {
  stopCleanupTimer();   // 1. 停止定时器
  await app.close();    // 2. 等待进行中的请求完成，然后关闭
  process.exit(0);      // 3. 退出进程
};
```

如果直接 `process.exit()`，正在处理中的请求会被强制中断——用户发了消息，LLM 正在生成回复，突然连接断了。`app.close()` 会先停止接受新连接，等现有请求处理完毕，再关闭。

---

## 六、API 契约速查

### POST /chat

```bash
# 创建新会话
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What does brilliant mean?"}'

# 响应
{"reply":"...","sessionId":"s_a1b2c3...","scenario":"VOCABULARY"}

# 继续对话（带上 sessionId）
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Give me an example", "sessionId": "s_a1b2c3..."}'
```

### 错误码

| HTTP | code | 何时触发 |
|------|------|----------|
| 400 | INVALID_REQUEST | 缺少 message 或格式不对（JSON Schema 校验） |
| 404 | SESSION_NOT_FOUND | sessionId 不存在或已过期 |
| 500 | LLM_ERROR | Moonshot API 调用失败 |
| 500 | INTERNAL_ERROR | 其他未预期错误 |

---

## 七、完整请求流程图

```
浏览器/curl 发送 POST /chat { message: "hello", sessionId: "s_xxx" }
    │
    ▼
[Fastify 自动校验 JSON Schema]
    │ 不合法 → 400 INVALID_REQUEST
    │ 合法 ↓
    ▼
[routes/chat.ts — 会话解析]
    │ sessionId 空/缺省 → sessionManager.create() 新建
    │ sessionId 非空 → sessionManager.get(id)
    │                    找不到 → 404 SESSION_NOT_FOUND
    │                    找到 ↓
    ▼
[ChatService.chat(session, message)]
    ├── classify(message)           → 判断意图：VOCABULARY
    ├── compressHistory(session)    → 如果超 10 轮，压缩历史
    ├── buildSystemPrompt(...)      → 组装 system prompt + CoT + RAG
    ├── runToolLoop(messages, tools) → 调用 LLM（可能触发字典工具）
    └── 更新 session.history        → 记录本轮对话
    │
    ▼
[routes/chat.ts — 构造响应]
    ├── sessionManager.touch(session)  → 续期 TTL
    └── 返回 { reply, sessionId, scenario }
    │
    ▼
浏览器/curl 收到 200 JSON 响应
```

---

## 八、未来扩展路线

| 优先级 | 改动 | 影响范围 |
|--------|------|----------|
| 高 | SSE 流式输出 | 新增 `GET /chat/:sessionId/stream`，ChatService 改为 yield 逐字 |
| 中 | SessionManager 换 Redis | 只改 `session-manager.ts` 内部实现，接口不变 |
| 中 | 认证鉴权 | 新增 Fastify 插件/钩子，路由层不用改 |
| 低 | 请求限流 | 新增 `@fastify/rate-limit` 插件 |
| 低 | CORS 限制域名 | 只改 `app.ts` 中 `origin` 配置 |

---

## 九、学到的设计原则

1. **状态要显式传递，不要藏在全局变量里** — 这是 CLI→Web API 改造的核心教训。全局变量在单用户 CLI 中没问题，但在多用户并发的 Web 环境中是灾难。

2. **依赖只能向下流动** — 路由层知道 Service 层，但 Service 层不知道路由层的存在。这样 Service 可以被多个入口（CLI、HTTP、未来的 WebSocket）复用。

3. **创建实例和启动实例分开** — `buildApp()` 返回配置好的实例但不启动，这样测试时可以用 `inject()` 模拟请求，不需要真的占用端口。

4. **先做对，再做快** — 方案 A 虽然工作量小，但并发竞态是根本性缺陷。多花 60% 工作量选方案 B，避免了未来必须推倒重来的风险。

5. **改造 ≠ 重写** — 整个改造中，classifier、prompts、rag、tools 完全没动。核心改动集中在一个文件（chat.ts → chat-service.ts），本质就是"把全局变量改成参数"。
