# Phase 2（Markdown）+ Phase 3（持久化）知识巩固总结

> 基于设计文档：  
> - `docs/superpowers/specs/2026-03-30-markdown-rendering-design.md`  
> - `docs/superpowers/specs/2026-03-31-conversation-persistence-design.md`  
> 并结合当前仓库实现整理，便于复习。  
> 日期：2026-04-06  
>
> **架构视角（技术选型与取舍、少代码）** 见同目录：[`2026-04-06-phase2-phase3-architecture-perspective.md`](./2026-04-06-phase2-phase3-architecture-perspective.md)。

---

## 0. 先读这一段：两个阶段各解决什么问题

| 阶段 | 解决的用户痛点 | 一句话 |
|------|----------------|--------|
| **Phase 2** | 助手回复里的 `**粗体**`、列表等以纯文本显示，难看 | **只改展示**：助手消息用 Markdown 渲染，用户消息仍纯文本（安全 + 简单） |
| **Phase 3** | 刷新页面或重启服务器后对话没了 | **状态可恢复**：磁盘上的 SQLite 存「给模型的上下文」和「给用户看的消息」；API 提供历史与重置 |

两个阶段在 spec 中写明**互不依赖**；实现顺序上先 2 后 3 很自然（先可读，再可存）。

---

## 1. Phase 2：Markdown 渲染（复习要点）

### 1.1 目标与非目标

- **目标：** assistant 的 `content` 按 Markdown 显示为富文本（粗体、斜体、列表、段落等），提升可读性。
- **非目标（明确不做）：**
  - 用户消息的 Markdown 解析（避免用户输入 `**` 被当成格式）
  - GFM 表格、任务列表、删除线等（YAGNI）
  - 代码块高亮（场景不需要）
  - 自定义 Markdown 组件（留给更后阶段）

### 1.2 技术选型（记住结论即可）

- **`react-markdown`：** Markdown → React 元素树，**不是**拼 HTML 字符串，因此**不依赖 `dangerouslySetInnerHTML`**，降低 XSS 风险。
- **`@tailwindcss/typography`：** `prose` 系列类给渲染出的 `p`/`ul`/`strong` 等默认排版；在聊天气泡里用 `prose-sm`、`max-w-none`、首尾 margin 与列表间距等**收紧**，避免「文章排版」过大。

### 1.3 组件行为（与代码一致）

- **`MessageBubble`：**  
  - `role === 'user'` → `<p className="... whitespace-pre-wrap">` 纯文本。  
  - `role === 'assistant'` → 外层容器挂 `prose` 相关类，内层 **`ReactMarkdown`** 渲染 `content`。  
- 实现里 `prose` 类挂在外层 `div` 上、内部再包 `ReactMarkdown`，与设计文档示意图「直接给 ReactMarkdown 加 className」等价，都是 Typography 作用在生成内容上。

### 1.4 设计文档中的文件清单（Phase 2）

| 区域 | 文件 | 作用 |
|------|------|------|
| 依赖 | `web/package.json` | `react-markdown`、`@tailwindcss/typography` |
| 样式入口 | `web/src/App.css` | `@plugin "@tailwindcss/typography"` |
| 组件 | `web/src/components/MessageBubble.tsx` | 用户/助手分支渲染 |
| 测试 | `web/src/components/__tests__/MessageBubble.test.tsx` | 粗体/斜体/列表/用户不解析等 |

**明确不改：** `useConversation`、`api/chat.ts`、`ChatWindow`、`MessageList`、`ChatInput`、`types/chat`、**整个后端**（Phase 2 与持久化无关）。

### 1.5 测试策略（复习时自检）

- 测「DOM 里有没有 `<strong>` / `<em>` / `<ul><li>`」，以及用户消息**没有**被解析成粗体。
- 不测：`react-markdown` 内部解析细节、像素级 CSS。

### 1.6 与后续阶段的衔接（spec 原话浓缩）

- **Streaming（Phase 4）：** `content` 变长即重渲染，组件模型可沿用。  
- **TTS / 更富组件：** 可给 `ReactMarkdown` 传 `components` 等扩展。  
- **GFM / 代码高亮：** 按需加 `remark-gfm`、`rehype-*` 插件。

---

## 2. Phase 3：对话记忆持久化（复习要点）

### 2.1 目标与非目标

- **目标：** 单用户**连续记忆**——跨**浏览器刷新**与**服务器重启**仍能继续上下文；提供**重新开始**清空记忆。
- **非目标：** 多用户/多租户、会话列表、无限历史、前端 localStorage 存对话、继续维护 CLI。

### 2.2 全书最重要的一个概念：两套数据

**LLM 看到的 ≠ 用户看到的。**

| 用途 | 存什么 | 谁用 |
|------|--------|------|
| **模型上下文** | 摘要 `summary` + 压缩后的 `history`（JSON，最近若干轮） | `chat-service` 调模型 |
| **界面展示** | 最近 **30** 条**原始**消息 | `GET /api/history` → 前端列表 |

原因：`compressHistory` 会**裁剪** `session.history`。若用同一份数据做列表，压缩后用户会看到消息「消失」。因此：

- **`sessions` 表** → 管 LLM 上下文（单行 `id = 'default'`）。
- **`messages` 表** → 管用户可见历史（按条追加，查询最近 30 条）。

### 2.3 数据模型速记

**`sessions`：** `id`, `summary`, `history`（TEXT JSON）, `created_at`, `last_active_at`。

**`messages`：** `id`, `role`, `content`, `scenario`, `timestamp`；`timestamp` 索引；无 `session_id`（单用户阶段不需要）。

### 2.4 后端分层（职责题常考）

| 模块 | 只做 | 不做 |
|------|------|------|
| `database.ts` | 连接、建表、`runTransaction` | 业务查询 |
| `session-repo.ts` | `sessions` 读写/重置 | messages |
| `message-repo.ts` | messages 追加、最近 N 条、清空 | sessions |
| `session-manager.ts` | 内存里唯一 `Session`、init/save/reset，委托 repo | 直接写 SQL |
| `chat-service.ts` | 分类、prompt、压缩、调 LLM | **不感知**持久化（Phase 3 不改此文件） |
| `routes/chat.ts` | HTTP、编排、事务边界 | LLM 逻辑 |

### 2.5 四条主流程（建议能画简图）

1. **启动：** `initDb()` → `initDefaultSession()` → `preloadRagKnowledge()` → `listen`；无 TTL 清理定时器。  
2. **`POST /api/chat`：** `getDefaultSession()` → `chat(session, message)` → **仅成功时** 在**同一事务**内：`save()` + `addMessage`（user）+ `addMessage`（assistant）。  
3. **`GET /api/history`：** `getRecentMessages(limit)` → 时间**正序**（旧→新），条数上限配置 `DISPLAY_MESSAGE_LIMIT`（默认 30）。  
4. **`POST /api/reset`：** 事务内清空 messages + `sessionManager.reset()`。

### 2.6 API 速查

| 方法 | 路径 | 请求 | 响应要点 |
|------|------|------|----------|
| POST | `/api/chat` | `{ message }` | `{ reply, scenario }`（无 sessionId） |
| GET | `/api/history` | — | `{ messages: Message[] }` |
| POST | `/api/reset` | — | `{ ok: true }` |
| GET | `/api/health` | — | `{ ok: true }` |

### 2.7 前端（Phase 3）要点

- 类型：`ChatRequest` / `ChatResponse` 去掉 `sessionId`；新增 `HistoryResponse`。  
- `fetchHistory`（挂载时）、`resetConversation`；`sendChatMessage` 只发 `message`。  
- `useConversation`：加载历史、发送、重置、错误处理（实现可对 history 失败做静默等，与 spec §7.2 一致即可）。  
- `ChatWindow`：**「重新开始」** 调用传入的 `onReset`。

**关于 MessageBubble：** Phase 3 spec 写「不改动 MessageBubble」是指 **Phase 3 任务范围内不再改它**；该文件已在 **Phase 2** 实现 Markdown，持久化后从历史接口拉回的 assistant 消息同样走 `ReactMarkdown` 渲染。

### 2.8 失败与一致性（易错题）

- **`chat()` 抛错：** **不写库**。内存里的 `session` 可能被部分更新，但 DB 仍是**上一次成功对话**的快照；下次成功写入后整体再对齐（spec §7.1）。  
- **首次启动 / 无库文件 / 无 `data/`：** `initDb` 创建目录与文件、建表。  
- **history 无数据：** `{ messages: [] }`。

### 2.9 CLI

- 删除 `src/index.ts`，移除 `dev:cli`；仅保留 Web + `dev:server` 路径（与当前仓库一致）。

### 2.10 演进（备忘）

- 多用户、多实例、云托管：倾向 **PostgreSQL** + 表加 `user_id` 等；**`src/db/`** 的 repository 形态便于换存储（spec §9.1）。

---

## 3. 合在一起：一条消息从发到显示（Phase 2 + 3）

1. 用户输入 → 前端 `POST /api/chat`（仅 `message`）。  
2. 后端用**磁盘恢复的 session** 调 `chat-service`，得到 `reply` / `scenario`。  
3. **成功**后事务：`sessions` 更新 + `messages` 插入 user 与 assistant 两行。  
4. 前端把新消息 append 到 `messages` state。  
5. **`MessageList` → `MessageBubble`：** user 纯文本；assistant **Markdown**（Phase 2）。  
6. 下次打开页面：`GET /api/history` 拉回最多 30 条，顺序已为正序，直接渲染（Phase 3 + Phase 2 叠加）。

---

## 4. 代码与文档对照表（复习时按文件扫）

| 主题 | 优先阅读文件 |
|------|----------------|
| Markdown / XSS 安全思路 | `web/src/components/MessageBubble.tsx` |
| Typography 插件 | `web/src/App.css` |
| SQLite 初始化与事务 | `src/db/database.ts` |
| 两张表职责 | `src/db/session-repo.ts`, `src/db/message-repo.ts` |
| 内存 session 与 DB | `src/services/session-manager.ts` |
| HTTP 与事务编排 | `src/routes/chat.ts` |
| 启动顺序 | `src/server.ts` |
| 模型与压缩（持久化边界外但相关） | `src/services/chat-service.ts` |
| 前端合同与请求 | `web/src/types/chat.ts`, `web/src/api/chat.ts` |
| 状态与历史 | `web/src/hooks/useConversation.ts` |
| 重置入口 UI | `web/src/components/ChatWindow.tsx` |

---

## 5. 自测清单（可当闪卡用）

**Phase 2**

- 为什么用户消息不用 Markdown？  
- `react-markdown` 为何有助于防 XSS？  
- `prose-sm` / `max-w-none` 大致解决什么问题？

**Phase 3**

- 为什么要有 `messages` 表而不能只靠 `session.history` 做列表？  
- `POST /api/chat` 失败时为什么不写数据库？  
- `save` 和两条 `addMessage` 为什么要同一事务？  
- `GET /api/history` 返回顺序对前端意味着什么？  
- 单用户全局 session 下，多台客户端连同一后端会看到什么？（同一记忆，非多租户）

---

## 6. 不确定点说明（已按代码核对）

- **MessageBubble 与 Phase 3 文档：** 文档「不改动」= Phase 3 不新增对该文件的修改；Markdown 来自 Phase 2，当前实现与设计意图一致。  
- **`ReactMarkdown` 的 className：** 设计图可写在 `ReactMarkdown` 上；实现用外层 `div` + `prose`，效果同类。

若你之后升级依赖或改路由前缀，以**实际代码**为准，并同步更新本文「对照表」一节。

---

## 7. 延伸阅读（仓库内）

- Phase 1 前端架构：`docs/superpowers/specs/2026-03-27-react-frontend-architecture-design.md`  
- Phase 2 / 3 **实现计划**（任务级）：`docs/superpowers/plans/2026-03-30-markdown-rendering.md`、`2026-03-31-conversation-persistence.md`  
- 全栈阅读路线：`docs/guides/2026-04-06-full-stack-reading-plan.md`
