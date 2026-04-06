# English Tutor Agent — 全栈代码阅读与掌控指南

> 日期：2026-04-06  
> 目的：对照设计文档与仓库现状，用**可执行顺序**读完整个项目（前端 + API + Agent + SQLite + RAG），把主动权握在自己手里。  
> 读者画像：熟悉 React、SQLite 经验较少亦可按本文顺序推进。

---

## 目录

1. [整机分层图](#1-整机分层图)
2. [设计文档怎么用](#2-设计文档怎么用)
3. [仓库与 Phase 3 计划的对齐](#3-仓库与-phase-3-计划的对齐)
4. [SQLite：只学本项目用到的](#4sqlite只学本项目用到的)
5. [从 React 脑模型桥接到后端](#5-从-react-脑模型桥接到后端)
6. [推荐阅读顺序](#6-推荐阅读顺序)
7. [第二遍：按子系统横切](#7-第二遍按子系统横切)
8. [测试当「可执行规格」](#8-测试当可执行规格)
9. [仓库内其他文档](#9-仓库内其他文档)
10. [实操练习](#10-实操练习)
11. [「掌控整个项目」自检标准](#11-掌控整个项目自检标准)
12. [可选：分天节奏](#12-可选分天节奏)

---

## 1. 整机分层图

把项目想成从下往上的依赖栈（**一条请求如何穿过各层**）：


| 层            | 职责                                     | 主要文件 / 目录                                                                                                    |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **运行时入口**    | 起 HTTP、初始化 SQLite、加载默认 session、预加载 RAG | `src/server.ts`                                                                                              |
| **HTTP 与装配** | CORS、统一错误 JSON、`/api/`* 路由挂载           | `src/app.ts`、`src/routes/chat.ts`                                                                            |
| **Agent 核心** | 分类、选 prompt、上下文压缩、OpenAI、工具、RAG        | `src/services/chat-service.ts`、`src/classifier.ts`、`src/prompts/`*、`src/tools/*`、`src/rag/*`、`src/client.ts` |
| **状态与持久化**   | 单例 session、两张表、事务                      | `src/services/session-manager.ts`、`src/db/`*、`src/config.ts`                                                 |
| **前端**       | 类型合同、`fetch`、状态、UI                     | `web/src/types/chat.ts`、`web/src/api/chat.ts`、`web/src/hooks/useConversation.ts`、`web/src/components/`*      |


### 一条 `POST /api/chat` 的竖切（背下来就赢了一半）

```
浏览器
  → web/src/api/chat.ts（sendChatMessage）
  → Fastify：src/routes/chat.ts
  → sessionManager.getDefaultSession()
  → chat(session, message)  // src/services/chat-service.ts，修改内存中的 session（history / summary）
  → 若成功：runTransaction(() => { sessionManager.save(); messageRepo.addMessage ×2 })
  → JSON { reply, scenario }
  → 前端 setMessages 等更新 UI
```

**关键不变量（Phase 3 persistence spec §7.1）：**仅在 `chat()` **成功返回后**才执行持久化；LLM 失败时不写库，避免 DB 与「一次失败对话」的中间态纠缠。

---

## 2. 设计文档怎么用

### 2.1 对话持久化（Phase 3）


| 文档             | 路径                                                                     | 角色                                                                     |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **设计（spec）**   | `docs/superpowers/specs/2026-03-31-conversation-persistence-design.md` | **真理来源**：目标/非目标、**LLM 上下文 vs 用户展示**（§2.1）、表结构、四条主流程、失败策略（§7）、测试期望（§8）。 |
| **实现计划（plan）** | `docs/superpowers/plans/2026-03-31-conversation-persistence.md`        | **文件地图 + Task 顺序**；用于查「动了哪些文件」和施工顺序。**读代码不必按 Task 顺序**，按本文 §6、§7 更高效。  |


读代码时每读完一层，回到 spec 对应小节做 **设计意图 vs 实现** 核对。

### 2.2 其他相关设计

- 前端架构：`docs/superpowers/specs/2026-03-27-react-frontend-architecture-design.md`
- Markdown 渲染：`docs/superpowers/specs/2026-03-30-markdown-rendering-design.md`

---

## 3. 仓库与 Phase 3 计划的对齐

根据仓库结构，**plan 中列出的后端与测试主体已落地**，包括但不限于：

- `src/db/database.ts`、`session-repo.ts`、`message-repo.ts` 及对应 `__tests__`
- `src/services/session-manager.ts` 及测试
- `src/routes/chat.ts`（`POST /chat`、`GET /history`、`POST /reset`）
- `src/server.ts` 启动链（`initDb`、`initDefaultSession`）
- 根目录 `vitest.config.ts`、`package.json` 中的 `better-sqlite3`、`vitest`、`test` script
- `src/index.ts`（CLI）已移除

**注意：**若你本地有未提交的 `web/src/*` 改动，阅读时应用 `git diff` 区分「当前工作区」与「已提交基线」，避免 mental model 混淆。

---

## 4. SQLite：只学本项目用到的

不必先系统学 SQL；下列概念 **够读通本仓库**：


| 概念                      | 在本项目中的含义                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| **一个 `.db` 文件**         | 结构化持久化存储；路径见 `src/config.ts` 的 `DB_PATH`，运行时通常在 `data/`。                         |
| **表 `sessions`**        | 给 LLM 的「大脑快照」：`summary` + JSON 字符串形式的 `history`；单用户场景下实质上一行（如 `id = 'default'`）。 |
| **表 `messages`**        | 给用户看的聊天记录；`GET /api/history` 主要读这里。                                              |
| **事务 `runTransaction`** | 多步写入要么全成功要么全回滚；路由中对成功对话的 `save` + 两条 `addMessage` 及 `reset` 流程依赖它。               |


**spec 核心（必读）：**`sessions` 与 `messages` **不能混用**——压缩 `history` 后，用户界面上的消息仍应从 `messages` 来，否则会出现「消息消失」类问题。见 persistence spec **§2.1**。

**阅读顺序建议：先读 `src/routes/chat.ts` 里何时**调用事务，再读 `src/db/message-repo.ts` / `session-repo.ts` 的**函数名与注释**，最后扫 `src/db/database.ts` 里的 **CREATE TABLE**（与 spec §3 对照）。

---

## 5. 从 React 脑模型桥接到后端


| 前端概念                                    | 后端对应                                       |
| --------------------------------------- | ------------------------------------------ |
| `fetchHistory` → `GET /api/history`     | `messages` 表的查询结果序列化为 `HistoryResponse`    |
| `sendChatMessage` → `POST /api/chat`    | LLM 成功后事务内：更新 `sessions` + 插入两行 `messages` |
| `resetConversation` → `POST /api/reset` | 清空展示数据 + 重置 session 行；前端再清空本地 `messages`   |


画图建议：内圈 **React state + 三个 API**；外圈 **每个 API 触及的表/事务**。

---

## 6. 推荐阅读顺序

采用 **「先竖切，再横切」** 两遍，比单线程啃某一目录更能建立全局掌控。

### 第一遍：竖切（一条消息走完全程）

1. `src/server.ts` — 启动顺序：`initDb` → `initDefaultSession` → `preloadRagKnowledge` → `listen`。
2. `src/app.ts` — `/api` 前缀、全局 `errorHandler` 与路由内 `try/catch` 的分工。
3. `src/routes/chat.ts` — 三端点 + **事务边界**。
4. `src/types/session.ts` + `src/services/session-manager.ts` — 内存 `Session` 与 DB 的加载/保存/重置。
5. `src/services/chat-service.ts` — 第一遍只抓 `**chat` 的输入输出**及其对 `session.history` / `session.summary` 的读写；压缩与 RAG 细节留到第二遍。
6. `web/src/types/chat.ts` → `web/src/api/chat.ts` → `web/src/hooks/useConversation.ts` — 与步骤 3 一一对应。

**第一遍结束自问：**为什么 LLM 失败时 DB 可以不更新，且设计上仍说得通？（persistence spec §7.1）

### 若你更熟 React：仍可把 6 提前扫一眼

快速建立合同后，**务必回到步骤 1–5**，否则持久化与 Agent 行为仍会「黑盒」。

---

## 7. 第二遍：按子系统横切


| 子系统        | 阅读重点                                                                         | 你应能回答                                               |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| **配置**     | `src/config.ts`                                                              | 模型、压缩阈值、RAG、DB 路径、展示条数等各影响什么                        |
| **OpenAI** | `src/client.ts`                                                              | 客户端如何被 `chat-service` 使用                            |
| **分类**     | `src/classifier.ts`                                                          | `Scenario` 枚举、新增场景的改动面                              |
| **Prompt** | `src/prompts/*.ts` + `chat-service` 内 `scenarioConfig`                       | 场景与 prompt 文件的对应关系                                  |
| **工具**     | `src/tools/dictionary.ts`                                                    | VOCABULARY 下为何会多轮模型调用                               |
| **RAG**    | `src/rag/chroma-store.ts`、`knowledge.ts`、`embedding.ts`、`src/prompts/rag.ts` | 无 `CHROMA_URL` 时的行为；启动预加载做了什么                       |
| **SQLite** | `src/db/database.ts`、`session-repo.ts`、`message-repo.ts`                     | 两张表职责；`getRecentMessages` 与 `DISPLAY_MESSAGE_LIMIT` |
| **前端 UI**  | `ChatWindow`、`MessageList`、`MessageBubble`、`ChatInput`                       | 展示与交互如何接到 hook                                      |


---

## 8. 测试当「可执行规格」

- **后端：**项目根目录 `npm test`（`src/**/*.test.ts`）。
- **前端：**`web/` 目录下 Vitest（`hooks`、`api`、`components` 等）。

每个 `describe` / `it` 描述的是**允许的行为**；与 persistence spec §8 及 plan 中的测试策略对照勾选，最易发现文档与实现漂移。

---

## 9. 仓库内其他文档

- 根目录 `README.md`、`web/README.md`：环境变量、启动方式、Chroma 等运维向说明。
- `docs/superpowers/plans/*.md`：各阶段实现任务拆解（与 spec 配对）。

---

## 10. 实操练习

1. **Network 跟踪：**仅开前端 + 后端，在 DevTools 中走通 `history` → `chat` → `reset`。
2. **DB 对照：**用 SQLite 浏览器打开 `data/english-tutor.db`，观察发消息与重置时 `sessions` / `messages` 的变化。
3. **失败路径：**模拟或观察 `POST /api/chat` 返回 500 时，**表内是否不应多出**对应轮次的用户/助手消息（与 §7.1 一致）。

---

## 11. 「掌控整个项目」自检标准

1. 能**手绘**端到端序列图（用户输入 → Fastify → session → `chat-service` → OpenAI → 返回 → 事务写库 → 前端状态）。
2. 能说明三项主要依赖：**OpenAI 凭据**、可选 `**CHROMA_URL`**、**SQLite 文件路径**。
3. 能说明改动 **classifier**、**压缩相关常量**、`**DISPLAY_MESSAGE_LIMIT`** 各波及哪些文件/行为。
4. 不看文档能解释 `**sessions` 与 `messages` 分工**及为何 `save` + 两条 `addMessage` 要落在同一事务里。

---

## 12. 可选：分天节奏

以下为 **4～5 个半天** 的示意切分；可按精力合并。


| 单元        | 内容                                                     | 自检                      |
| --------- | ------------------------------------------------------ | ----------------------- |
| **D1 上午** | `server.ts`、`app.ts`、`routes/chat.ts`                  | 说出三个 API 的路径与事务边界       |
| **D1 下午** | `session-manager` + `db/`* + persistence spec §2–4     | 画出两张表与三个 HTTP 流程        |
| **D2 上午** | `chat-service.ts` 主路径 + `classifier` + `types/session` | 说清一次用户输入触发的模型调用次数（常见路径） |
| **D2 下午** | `prompts/`*、`tools/dictionary`、`rag/*`                 | 说清 RAG 关闭与开启时的差异        |
| **D3**    | `web/src` 类型、API、hook、关键组件 + 前后端测试                     | 能对照测试描述 hook 的挂载与发送行为   |


---

## 相关链接（仓库内）

- Phase 3 设计：`docs/superpowers/specs/2026-03-31-conversation-persistence-design.md`
- Phase 3 计划：`docs/superpowers/plans/2026-03-31-conversation-persistence.md`

---

*本指南由开发过程中的阅读路线整理而成；若实现变更，请以代码与最新 spec 为准，并酌情更新本文。*