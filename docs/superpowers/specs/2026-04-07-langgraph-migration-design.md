# LangGraph 架构改造设计文档

> 日期：2026-04-07
> 目的：将 English Tutor Agent 的手工编排层改造为 LangGraph StateGraph，标准化抽象并为 Streaming（Phase 4）铺路。
> 前提：读者已熟悉本项目当前架构（见 `docs/guides/2026-04-06-full-stack-reading-plan.md`）。
> 状态：设计阶段

---

## 目录

1. [改造目标与非目标](#1-改造目标与非目标)
2. [技术选型结论](#2-技术选型结论)
3. [架构总览：当前 vs 改造后](#3-架构总览当前-vs-改造后)
4. [State Schema 设计](#4-state-schema-设计)
5. [Graph 节点与边定义](#5-graph-节点与边定义)
6. [与现有系统的兼容策略](#6-与现有系统的兼容策略)
7. [分阶段改造路径](#7-分阶段改造路径)
8. [依赖变更](#8-依赖变更)
9. [测试策略](#9-测试策略)
10. [风险与缓解](#10-风险与缓解)
11. [明确不做的事](#11-明确不做的事)
12. [术语表](#12-术语表)

---

## 1. 改造目标与非目标

### 1.1 目标

| # | 目标 | 衡量标准 |
|---|------|---------|
| G1 | **标准化编排抽象**：用 LangGraph StateGraph 替代 `chat-service.ts` 中的命令式调度 | 新增场景/工具不需要修改图的核心编排逻辑，只需加节点和边 |
| G2 | **为 Streaming 铺路**：改造后的图原生支持 `graph.stream()` / `graph.streamEvents()` | Phase 4 实现时只需对接前端 SSE，不需要重写后端 Agent 核心 |
| G3 | **保持功能不变**：改造前后，所有现有功能（分类、CoT、RAG、工具、压缩、持久化）行为一致 | 现有测试全部通过，手动验证四种场景行为不变 |
| G4 | **学习即改造**：每个阶段引入可控数量的 LangGraph 概念，确保掌控度 | 每阶段附带学习目标和自检清单 |

### 1.2 非目标

- **不改数据层**：SQLite 双轨存储（sessions + messages）、Repository 模式、事务边界不变。
- **不改前端**：Phase 0–3 期间 API 契约（`POST /chat`、`GET /history`、`POST /reset`）不变，`web/` 零改动。
- **不引入 LangGraph 持久化**：不使用 `MemorySaver` 或 `SqliteSaver` 替代现有 session 持久化。现有方案已满足需求，LangGraph checkpointer 是可选的未来增强。
- **不引入多 Agent**：本次改造聚焦单图重构，不拆分为子 Agent / 子图。
- **不实现 Streaming**：Streaming 是 Phase 4 的内容，本次只确保架构上「可接入」。

---

## 2. 技术选型结论

### 2.1 选择：LangGraph StateGraph + LangChain 原语

**不选 LangChain Only（LCEL）的原因：**

| 维度 | LCEL | LangGraph StateGraph |
|------|------|---------------------|
| 场景路由 | `RunnableBranch`，4 分支 × 不同工具/prompt 组合笨重 | `addConditionalEdges`，声明式路由，加场景 = 加一条边 |
| 工具循环 | 依赖 `AgentExecutor` 黑盒，或手写循环 | 图内 cycle 是一等公民，终止条件通过边的返回值控制 |
| 并行执行 | `RunnableParallel` 可行但语义不够显式 | fan-out / fan-in 是图的自然表达 |
| Streaming | `.stream()` 支持，但粒度有限 | `graph.stream()` 支持节点级、token 级事件流 |
| 可视化 | 无 | 图可导出为 Mermaid，架构即代码 |
| 自定义压缩 | 内置 Memory 类不支持本项目的增量摘要策略 | 压缩作为普通节点，完全自定义 |

**不选 `createReactAgent` 预构建的原因：** 不支持场景分类路由，会丢失 CoT/Few-shot 按场景注入的核心设计。

### 2.2 现有代码与 LangGraph 概念的对应

| 你已经写过/理解的 | LangGraph 对应概念 | 说明 |
|---|---|---|
| `chat()` 函数中的调度逻辑 | `StateGraph`（图） | 整个 `chat()` 就是一张图的命令式写法 |
| `classify`、`compressHistory`、`buildSystemPrompt`、`runToolLoop` | Node（节点） | 每个函数 = 一个节点 |
| `if (scenario === 'VOCABULARY') tools = [dictionaryTool]` | Conditional Edge（条件边） | 根据分类结果路由到不同配置 |
| `while (true) { ... if no tool_calls break }` | Cycle（图内循环） | `callLLM ↔ tools` 的有限循环 |
| `Session` 对象 (`history`, `summary`) | State Annotation（类型化状态） | 图的全局状态，在节点间传递 |
| `Promise.all([classify(), compressHistory()])` | Parallel fan-out（并行分叉） | START 同时触发多个节点 |

---

## 3. 架构总览：当前 vs 改造后

### 3.1 当前架构（手工编排）

控制流集中在 `chat-service.ts` 的 `chat()` 函数：

```
chat(session, userMessage)
├── Promise.all([classify(), compressHistory()])     ← 并行
├── scenarioConfig[scenario]                          ← 查表
├── buildSystemPrompt(scenario, cot, summary, msg)    ← 含 RAG
├── messages = [system, ...fewShot, ...history, user]
├── tools = scenario === 'VOCABULARY' ? [dict] : undefined
├── runToolLoop(messages, tools)                      ← while 循环
├── session.history.push(user, assistant)
└── return { reply, scenario }
```

**特点：** 编排逻辑、状态变更、LLM 调用混在同一函数体内。加新场景/工具需要改动函数内部。

### 3.2 改造后架构（LangGraph StateGraph）

```
                         ┌─────────────┐
              ┌─────────→│  classify    │──────────┐
              │          └─────────────┘           │
  __start__ ──┤                              (join)├──→ buildPrompt ──→ callLLM
              │          ┌─────────────┐           │         ▲              │
              └─────────→│  compress    │──────────┘         │              │
                         └─────────────┘               ┌─────────┐    conditional
                                                       │  tools   │←── has tools?
                                                       └─────────┘         │
                                                                      no tools
                                                                           │
                                                                       __end__
```

**每个方框 = 一个独立函数（Node），箭头 = Edge。**

调用方式从：
```typescript
const result = await chat(session, userMessage);
```
变为：
```typescript
const result = await graph.invoke({ userMessage, history, summary });
```

### 3.3 改造边界

**改造的是编排层**（`chat-service.ts`），**不动数据层**（`db/`、`session-manager`）也**不动表现层**（`web/`）。

```
┌──────────────────────────────────────────────┐
│  web/ (前端)                                  │  ← 不变
├──────────────────────────────────────────────┤
│  routes/chat.ts (HTTP + 事务)                │  ← 调用方式微调
├──────────────────────────────────────────────┤
│  chat-service.ts (编排)                      │  ← ★ 改造目标
│    ├── classifier.ts                         │
│    ├── prompts/*.ts                          │
│    ├── tools/dictionary.ts                   │
│    ├── rag/*.ts                              │
│    └── client.ts                             │
├──────────────────────────────────────────────┤
│  db/ + session-manager (持久化)              │  ← 不变
└──────────────────────────────────────────────┘
```

---

## 4. State Schema 设计

### 4.1 图状态定义

```typescript
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Scenario } from "./classifier.js";

export const TutorState = Annotation.Root({
  // ── 输入（由调用方填充）──
  userMessage: Annotation<string>,
  history: Annotation<BaseMessage[]>,
  summary: Annotation<string>,

  // ── classify 节点输出 ──
  scenario: Annotation<Scenario>,

  // ── compress 节点输出（可能更新 history 和 summary）──
  compressedHistory: Annotation<BaseMessage[]>,
  compressedSummary: Annotation<string>,

  // ── buildPrompt 节点输出 ──
  systemPrompt: Annotation<string>,
  fewShot: Annotation<BaseMessage[]>,
  activeTools: Annotation<StructuredToolInterface[] | undefined>,

  // ── callLLM / tools 循环使用 ──
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
  }),
  toolIterations: Annotation<number>,  // 工具循环计数器，用于强制终止

  // ── 最终输出 ──
  reply: Annotation<string>,
});
```

### 4.2 设计原则

- **State 只放图内传递数据**：SQLite 持久化仍由路由层负责，不混入图状态。
- **reducer 用于累积型字段**：`messages` 字段使用 reducer，支持工具循环中的消息追加。
- **输入/输出分离**：调用方只需填 `userMessage` / `history` / `summary`，从结果中取 `reply` / `scenario`。

### 4.3 与现有 Session 的关系

```
现有 Session {id, summary, history}
    │
    │ 图执行前：从 Session 读取 history + summary 填入 State
    │ 图执行后：从 State 读取 compressedHistory + compressedSummary 写回 Session
    │
    └→ 持久化逻辑不变（routes/chat.ts 的事务）
```

---

## 5. Graph 节点与边定义

### 5.1 节点清单

| 节点名 | 对应现有代码 | 输入（从 State 读） | 输出（写入 State） | LLM 调用 |
|--------|-------------|-------------------|-------------------|----------|
| `classify` | `classifier.ts: classify()` | `userMessage` | `scenario` | 1 次（轻量分类） |
| `compress` | `chat-service.ts: compressHistory()` | `history`, `summary` | `compressedHistory`, `compressedSummary` | 0 或 1 次（仅触发压缩时） |
| `buildPrompt` | `chat-service.ts: buildSystemPrompt()` + `scenarioConfig` 查表 | `scenario`, `compressedSummary`, `userMessage` | `systemPrompt`, `fewShot`, `activeTools`, `messages`（初始消息列表） | 0 次（RAG 检索不算 LLM） |
| `callLLM` | `runToolLoop` 中的 `client.chat.completions.create()` | `messages`, `activeTools` | `messages`（追加 LLM 响应） | 1 次 |
| `executeTools` | `runToolLoop` 中的 tool_calls 处理 | `messages`（最后一条的 tool_calls） | `messages`（追加 tool 结果）、`toolIterations`（+1） | 0 次（API 调用，非 LLM） |
| `respond` | `chat()` 末尾的 return | `messages`, `scenario` | `reply` | 0 次 |

### 5.2 边定义

```typescript
const workflow = new StateGraph(TutorState)
  // 节点注册
  .addNode("classify", classifyNode)
  .addNode("compress", compressNode)
  .addNode("buildPrompt", buildPromptNode)
  .addNode("callLLM", callLLMNode)
  .addNode("executeTools", executeToolsNode)
  .addNode("respond", respondNode)

  // 并行：START → classify + compress
  .addEdge("__start__", "classify")
  .addEdge("__start__", "compress")

  // 汇合：classify + compress → buildPrompt
  .addEdge("classify", "buildPrompt")
  .addEdge("compress", "buildPrompt")

  // 线性：buildPrompt → callLLM
  .addEdge("buildPrompt", "callLLM")

  // 条件：callLLM → tools? / respond?
  .addConditionalEdges("callLLM", routeAfterLLM, {
    "executeTools": "executeTools",
    "respond": "respond",
  })

  // 循环或终止：executeTools → callLLM（继续）或 respond（达到上限）
  .addConditionalEdges("executeTools", routeAfterTools, {
    "callLLM": "callLLM",
    "respond": "respond",
  })

  // 结束
  .addEdge("respond", "__end__");
```

### 5.3 条件路由函数

**callLLM 的出边路由**：决定是进入工具执行还是直接回复。

```typescript
function routeAfterLLM(state: typeof TutorState.State): "executeTools" | "respond" {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && "tool_calls" in lastMessage && lastMessage.tool_calls?.length) {
    return "executeTools";
  }
  return "respond";
}
```

**executeTools 的出边路由**：决定是继续循环还是因达上限而终止（详见 §7 Phase 3）。

```typescript
function routeAfterTools(state: typeof TutorState.State): "callLLM" | "respond" {
  if (state.toolIterations >= MAX_TOOL_ITERATIONS) {
    return "respond";
  }
  return "callLLM";
}
```

**边界情况**：当因 `toolIterations` 达上限而强制路由到 `respond` 时，最后一条消息可能是 tool 结果而非文本回复。`respond` 节点应处理此情况——从 messages 中提取最后一条包含文本内容的 AI 消息，若无则返回一个兜底提示（如「抱歉，我暂时无法完成查询，请稍后再试」）。

### 5.4 节点实现要点

**classify 节点**：内部逻辑与现有 `classifier.ts` 基本一致，用 `ChatOpenAI` 替代直接 SDK 调用。

**compress 节点**：
- 读取 `state.history` 和 `state.summary`
- 如果轮数 < `COMPRESS_THRESHOLD`，直接输出 `compressedHistory = history`，`compressedSummary = summary`
- 如果触发压缩，调用 LLM 生成新摘要，裁剪 history

**buildPrompt 节点**：
- 从 `scenarioConfig[scenario]` 获取 CoT 和 fewShot
- 执行 RAG 检索（如果 chromaReady 且非 OFF_TOPIC）
- 组装 systemPrompt 并初始化 messages 列表

**callLLM 节点**：
- 用 `model.invoke(state.messages)` 或 `model.bindTools(state.activeTools).invoke(state.messages)` 调用 LLM
- 返回 `{ messages: [response] }` 触发 reducer 追加

**executeTools 节点**：
- 解析最后一条消息的 `tool_calls`
- 执行对应工具函数
- 返回 `{ messages: [toolMessage1, toolMessage2, ...] }` 追加到消息列表

**respond 节点**：
- 从最后一条消息中提取文本内容作为 `reply`
- 输出 `{ reply, scenario }`（scenario 从 state 透传）

---

## 6. 与现有系统的兼容策略

### 6.1 LLM 提供商：Moonshot

当前通过 OpenAI SDK + 自定义 `baseURL` 连接 Moonshot。改造后：

```typescript
import { ChatOpenAI } from "@langchain/openai";

export const chatModel = new ChatOpenAI({
  configuration: {
    baseURL: "https://api.moonshot.cn/v1",
  },
  apiKey: process.env.MOONSHOT_API_KEY,
  model: CHAT_MODEL,
});
```

**注意**：现有代码在生成摘要时使用了 Moonshot 扩展参数 `thinking: { type: 'disabled' }`。LangChain 的 `ChatOpenAI` 支持通过 `modelKwargs` 或 `.bind()` 传递额外参数：

```typescript
const summaryModel = chatModel.bind({
  // @ts-expect-error Moonshot 扩展参数
  thinking: { type: "disabled" },
  max_completion_tokens: SUMMARY_MAX_TOKENS,
});
```

若此方式不可行，可创建轻量 wrapper 或在该节点内继续使用原始 OpenAI SDK。

### 6.2 Embedding：SiliconFlow

当前 `rag/embedding.ts` 直接调用 SiliconFlow API。两种策略：

- **Phase 0 保守策略（推荐）**：保留 `embedding.ts` 原样，`chroma-store.ts` 不变。图内 `buildPrompt` 节点直接调用现有 `retrieveFromChroma()`。
- **后续可选**：将 SiliconFlow 封装为 LangChain `Embeddings` 子类，统一到框架体系。

### 6.3 Chroma 向量库

保留现有 `chromadb` 直接客户端。`chroma-store.ts` 的 `retrieveFromChroma()` 和 `initChromaRag()` 接口不变。

不引入 `@langchain/community` 的 Chroma 集成，避免增加不必要的依赖和迁移面。

### 6.4 SQLite 持久化

**完全不变**。路由层调用方式从：

```typescript
// 现有
const result = await chat(session, message);
```

变为：

```typescript
// 改造后
const result = await tutorGraph.invoke({
  userMessage: message,
  history: session.history.map(toBaseMessage),
  summary: session.summary,
});

// 从结果中更新 session（对应现有 chat() 末尾的 history push + summary 更新）
session.history = result.compressedHistory.map(fromBaseMessage);
session.summary = result.compressedSummary;
// ★ 关键：追加本轮用户消息和 assistant 回复到 history（与现有行为一致）
session.history.push(
  { role: 'user', content: message },
  { role: 'assistant', content: result.reply }
);
```

事务逻辑（`runTransaction` 包裹 save + addMessage × 2）不变。

**注意**：现有 `chat()` 在工具循环结束后有两次 `session.history.push`（用户消息 + assistant 回复）。改造后这一步移到路由层，确保 session 写入 DB 时包含完整的本轮对话。

### 6.5 消息格式转换

现有代码使用 OpenAI SDK 的 `ChatCompletionMessageParam`，LangGraph 使用 LangChain 的 `BaseMessage`。需要在路由层做转换：

```typescript
function toBaseMessage(msg: ChatCompletionMessageParam): BaseMessage { ... }
function fromBaseMessage(msg: BaseMessage): ChatCompletionMessageParam { ... }
```

这些转换函数作为**适配层**放在新增的 `src/graph/adapters.ts` 中。

---

## 7. 分阶段改造路径

每个阶段独立可交付、可测试。每个阶段完成后系统应完全可用。

---

### Phase 0：LangChain 原语替换（不动编排）

**目标**：用 LangChain 标准类替换底层组件，验证 Moonshot 兼容性，同时学习 LangChain 基础 API。编排逻辑暂时不变。

**涉及文件**：

| 文件 | 变更 |
|------|------|
| `src/client.ts` | `new OpenAI(...)` → `new ChatOpenAI(...)` |
| `src/tools/dictionary.ts` | `ChatCompletionTool` 对象 → `StructuredTool` 类（用 zod schema） |
| `src/classifier.ts` | 内部调用从 `client.chat.completions.create()` 改为 `chatModel.invoke()` |
| `package.json` | 新增 `@langchain/core`、`@langchain/openai`、`zod` |

**编排（`chat-service.ts`）**：基本不变，只是调用的底层类换了。`runToolLoop` 的 while 循环暂时保留。

**学习目标**：

| 概念 | 要理解的问题 |
|------|-------------|
| `ChatOpenAI` | 它和 `new OpenAI()` 的区别？`baseURL` / `apiKey` 怎么配？ |
| `BaseMessage` 体系 | `HumanMessage` / `AIMessage` / `SystemMessage` / `ToolMessage` 和 OpenAI 的 `role` 有什么对应关系？ |
| `StructuredTool` | 用 zod schema 定义工具参数比 JSON Schema 对象有什么优势？ |
| `.invoke()` vs `.stream()` | 统一调用接口的设计意图是什么？ |

**掌控度自检**：
- [ ] 能解释 `ChatOpenAI` 如何通过 `baseURL` 兼容 Moonshot
- [ ] 能手动将一个 `ChatCompletionMessageParam` 转换为对应的 `BaseMessage` 子类
- [ ] 能说出 `StructuredTool` 的 `_call` 方法在什么时候被调用
- [ ] 替换后所有现有测试通过，手动验证四种场景行为不变

---

### Phase 1：最简 StateGraph（线性图，无条件边）

**目标**：把 `chat()` 拆成 Graph 的节点和线性边，建立对 StateGraph 的基本理解。**暂不使用条件边和循环**——所有场景走同一条路径，工具循环暂时留在 `callLLM` 节点内部。

**涉及文件**：

| 文件 | 变更 |
|------|------|
| `src/graph/state.ts` | **新增**：定义 `TutorState` Annotation |
| `src/graph/nodes/classify.ts` | **新增**：classify 节点 |
| `src/graph/nodes/compress.ts` | **新增**：compress 节点 |
| `src/graph/nodes/build-prompt.ts` | **新增**：buildPrompt 节点 |
| `src/graph/nodes/call-llm.ts` | **新增**：callLLM 节点（内部暂保留 while 循环） |
| `src/graph/nodes/respond.ts` | **新增**：respond 节点 |
| `src/graph/index.ts` | **新增**：组装图并 compile |
| `src/graph/adapters.ts` | **新增**：BaseMessage ↔ ChatCompletionMessageParam 转换 |
| `src/services/chat-service.ts` | 保留但简化为调用 `graph.invoke()` 的薄包装 |
| `src/routes/chat.ts` | 微调：适配新的调用方式和返回格式 |
| `package.json` | 新增 `@langchain/langgraph` |

**Phase 1 的图结构（线性）**：
```
__start__ → classify → compress → buildPrompt → callLLM → respond → __end__
```

注意：这里 classify 和 compress 是**串行**的（先分类再压缩），与现有的并行不同。这是有意的简化——Phase 1 聚焦理解 StateGraph 的基本机制，并行优化留到后续。

**学习目标**：

| 概念 | 要理解的问题 |
|------|-------------|
| `StateGraph` | 图是怎么创建和编译的？`compile()` 做了什么？ |
| `Annotation` | State 是怎么定义的？节点怎么读写 State？ |
| Node 函数签名 | 节点函数接收什么参数？返回什么？返回值怎么合并到 State？ |
| `addEdge` | 普通边和 `__start__` / `__end__` 的语义是什么？ |
| `graph.invoke()` | 输入和输出分别是什么类型？ |

**掌控度自检**：
- [ ] 能手绘 Phase 1 的图结构（6 个节点，5 条线性边）
- [ ] 能解释 `graph.invoke({ userMessage, history, summary })` 执行时，State 在每个节点间如何传递
- [ ] 能解释为什么节点函数返回的是**部分 State**（Partial）而不是完整 State
- [ ] 能说出 reducer 的作用——如果 `messages` 字段没有 reducer 会怎样
- [ ] 所有现有测试通过

---

### Phase 2：条件边 + 并行（场景路由 + classify/compress 并行）

**目标**：引入 LangGraph 的条件边和并行执行，让图结构真正反映业务逻辑。

**涉及文件**：

| 文件 | 变更 |
|------|------|
| `src/graph/index.ts` | 改造边定义：`addConditionalEdges`、并行 fan-out |
| `src/graph/nodes/build-prompt.ts` | 可能拆分为多个场景变体，或用条件逻辑内聚在一个节点 |

**Phase 2 的图结构**：
```
              ┌── classify ──┐
__start__ ──┤                ├──→ buildPrompt → callLLM → respond → __end__
              └── compress ──┘
```

**关键变更**：
1. `__start__` 同时触发 `classify` 和 `compress`（并行 fan-out）
2. 两者都完成后才触发 `buildPrompt`（fan-in / join）
3. `buildPrompt` 内部根据 `state.scenario` 选择 CoT / fewShot / 工具（与现有 `scenarioConfig` 逻辑相同）

**注意**：LangGraph 的并行 fan-out 要求两个节点写入 State 的**不同字段**，否则会冲突。`classify` 写 `scenario`，`compress` 写 `compressedHistory` + `compressedSummary`——天然不冲突。

**学习目标**：

| 概念 | 要理解的问题 |
|------|-------------|
| `addConditionalEdges` | 条件边的路由函数签名和返回值的约定？ |
| 并行 fan-out | 一个节点后接多条边时，LangGraph 怎么调度？ |
| fan-in / join | 多个并行节点完成后如何汇合到下一个节点？ |
| State 合并 | 并行节点各自返回的部分 State 怎么合并？冲突怎么办？ |

**掌控度自检**：
- [ ] 能画出并行 fan-out 和 fan-in 的图结构
- [ ] 能解释为什么 classify 和 compress 可以安全并行（写不同字段）
- [ ] 能说出如果新增一个场景（如 `PRONUNCIATION`），需要改哪些地方
- [ ] 所有现有测试通过

---

### Phase 3：图内循环（工具循环）

**目标**：把 `callLLM` 节点内部的 while 循环拆出来，变成图级别的 `callLLM ↔ executeTools` 循环。

**涉及文件**：

| 文件 | 变更 |
|------|------|
| `src/graph/nodes/call-llm.ts` | 移除内部 while 循环，单次 LLM 调用 |
| `src/graph/nodes/execute-tools.ts` | **新增**：独立的工具执行节点 |
| `src/graph/index.ts` | 新增条件边（callLLM → executeTools or respond）和回边（executeTools → callLLM） |

**Phase 3 的图结构（完整）**：
```
              ┌── classify ──┐
__start__ ──┤                ├──→ buildPrompt ──→ callLLM ──→ conditional
              └── compress ──┘         ▲                        │      │
                                       │                   tools?    no tools?
                                       │                        │      │
                                  executeTools ←────────────────┘   respond
                                       │                               │
                                  conditional                      __end__
                                   │        │
                              continue?   max reached?
                                   │        │
                               callLLM   respond
```

注意 `executeTools` 有**两组出边**：正常情况循环回 `callLLM`，达到 `MAX_TOOL_ITERATIONS` 时强制跳到 `respond`。

**安全机制**：循环次数上限（`MAX_TOOL_ITERATIONS`）仍然保留。实现方式：`executeTools` 节点内维护迭代计数器（通过 State 中的 `toolIterations` 字段），执行后通过**条件边**决定下一步：

```typescript
// executeTools 节点的出边也是条件边
.addConditionalEdges("executeTools", routeAfterTools, {
  "callLLM": "callLLM",
  "respond": "respond",
})

function routeAfterTools(state: typeof TutorState.State): "callLLM" | "respond" {
  if (state.toolIterations >= MAX_TOOL_ITERATIONS) {
    return "respond"; // 达到上限，强制终止循环
  }
  return "callLLM"; // 继续循环
}
```

对应的完整图结构中，`executeTools` 有**两条出边**（→ callLLM 或 → respond），而非只有一条。

**学习目标**：

| 概念 | 要理解的问题 |
|------|-------------|
| Cycle（图内循环） | 图怎么表达「有可能回到之前的节点」？和无限循环有什么区别？ |
| 循环终止 | 终止条件通过边的路由返回值控制，不是 while/break |
| `ToolNode` | LangGraph 预构建的 `ToolNode` vs 手写 executeTools 节点？（了解即可，本项目用手写） |
| messages reducer | 工具循环中，每轮的 AI 响应和 tool 结果怎么累积？ |

**掌控度自检**：
- [ ] 能解释 `callLLM → executeTools → callLLM` 循环的终止条件
- [ ] 能说出为什么 `messages` 字段需要 reducer 而 `reply` 不需要
- [ ] 能说出最大迭代次数在哪里控制，到达上限时怎么处理
- [ ] 能解释手写 executeTools 和 LangGraph 预构建 `ToolNode` 的区别
- [ ] 所有现有测试通过

---

### 迁移 Phase 4：Streaming 技术验证（为产品 Phase 4 铺路）

> 注意：此处「迁移 Phase 4」指本次 LangGraph 改造的第四步，与产品路线图中的「Phase 4（Streaming 响应）」是不同层面。本步骤只做技术验证，不实现前端 Streaming UI。

**目标**：验证改造后的图支持 `graph.stream()` / `graph.streamEvents()`，输出技术验证报告。

**涉及文件**：

| 文件 | 变更 |
|------|------|
| `src/graph/index.ts` | 验证 `graph.stream()` 的输出格式 |
| 新增验证脚本 | `src/graph/verify-streaming.ts`：独立脚本，验证流式事件 |

**验证内容**：
1. `graph.stream({ ... }, { streamMode: "values" })`：节点级状态快照流
2. `graph.stream({ ... }, { streamMode: "updates" })`：每个节点的增量更新
3. `graph.streamEvents({ ... })`：token 级事件流（`on_chat_model_stream`）

**输出**：一份简短的技术验证文档，确认 streaming 可行性和前端对接方式建议。

**学习目标**：

| 概念 | 要理解的问题 |
|------|-------------|
| `graph.stream()` | `values` 和 `updates` 两种模式的区别？ |
| `streamEvents` | 事件的类型和粒度？怎么拿到逐 token 的输出？ |
| SSE 对接 | 后端怎么把 graph.stream() 的输出转成 SSE 发给前端？ |

**掌控度自检**：
- [ ] 能说出 `stream("values")` 和 `stream("updates")` 分别返回什么
- [ ] 能说出 `streamEvents` 中 `on_chat_model_stream` 事件的数据结构
- [ ] 能画出 streaming 数据从 LLM → graph → Fastify → SSE → 前端的完整路径
- [ ] 验证脚本能成功运行并输出流式事件

---

## 8. 依赖变更

### 8.1 新增依赖

| 包 | 引入阶段 | 用途 |
|----|---------|------|
| `@langchain/core` | Phase 0 | 基础抽象：BaseMessage、StructuredTool、Embeddings |
| `@langchain/openai` | Phase 0 | ChatOpenAI（兼容 Moonshot） |
| `zod` | Phase 0 | 工具参数 schema 定义 |
| `@langchain/langgraph` | Phase 1 | StateGraph、Annotation、编译和执行 |

### 8.2 保留的依赖

| 包 | 说明 |
|----|------|
| `fastify` / `@fastify/cors` | HTTP 层不变 |
| `better-sqlite3` | 持久化层不变 |
| `chromadb` | RAG 直接使用，不引入 LangChain Chroma 集成 |

### 8.3 可移除的依赖（Phase 3 完成后）

| 包 | 说明 |
|----|------|
| `openai` | 被 `@langchain/openai` 替代。注意：`@langchain/openai` 内部依赖 `openai`，所以它会作为间接依赖保留，但项目代码不再直接引用 |

---

## 9. 测试策略

### 9.1 原则

- **每个 Phase 完成后，现有测试必须全部通过**。
- 现有测试覆盖的是行为（API 层面），不依赖内部实现。编排层改造不应破坏这些测试。
- 新增测试聚焦**图级行为**，不测节点内部实现。

### 9.2 各阶段测试重点

| 阶段 | 测试重点 |
|------|---------|
| Phase 0 | `ChatOpenAI` 能正确连接 Moonshot 并返回结果；`StructuredTool` 的字典工具能正确执行 |
| Phase 1 | `graph.invoke()` 端到端返回正确的 `reply` 和 `scenario`；线性图的节点执行顺序正确 |
| Phase 2 | 不同场景的条件路由正确；并行节点的 State 合并正确 |
| Phase 3 | 工具循环能正确终止（有工具、无工具、达到上限三种情况）；循环中 messages 正确累积 |
| Phase 4 | streaming 验证脚本运行成功 |

### 9.3 回归验证

每个 Phase 完成后的手动验证清单：

- [ ] VOCABULARY 场景：问一个单词，确认字典工具被调用且回复包含音标/释义
- [ ] GRAMMAR_CORRECTION 场景：输入一句语法错误的英文，确认纠正回复
- [ ] EXPRESSION 场景：用中文问「怎么说」，确认英文表达回复
- [ ] OFF_TOPIC 场景：问非英语学习问题，确认委婉拒绝
- [ ] 历史压缩：连续对话超过 COMPRESS_THRESHOLD 轮，确认摘要生成
- [ ] 刷新恢复：刷新页面后历史消息仍在

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Moonshot API 与 `ChatOpenAI` 不完全兼容（如 `thinking` 参数） | Phase 0 阻塞 | Phase 0 第一步即验证；若不兼容，compress 节点内保留原始 SDK 调用 |
| LangGraph 引入的间接依赖与现有依赖版本冲突 | 构建失败 | Phase 0 安装后立即 `npm ls` 检查；必要时 pin 版本 |
| 图状态设计不合理导致后续阶段返工 | Phase 1-2 需要调整 State | Phase 1 用最简 State，按需渐进扩展字段 |
| 并行 fan-out 在 LangGraph.js 中的行为与预期不符 | Phase 2 阻塞 | Phase 2 前先写独立验证脚本；若不支持原生 fan-out，回退到 Phase 1 的串行方案 |
| 学习曲线导致进度慢于预期 | 整体延期 | 每个 Phase 都是独立可用的；即使只完成 Phase 0-1，系统仍可正常运行 |

---

## 11. 明确不做的事

| 事项 | 为什么不做 |
|------|-----------|
| 替换 SQLite 持久化 | 与编排层改造正交，产品 Phase 3（对话持久化）设计已满足需求 |
| 引入 LangGraph checkpointer | 现有 session 管理已工作良好；checkpointer 是未来可选增强 |
| 前端 Streaming UI | 是产品层面的 Phase 4，本次只确保后端「可接入」 |
| 多 Agent / 子图 | 当前单图足够，多 Agent 是未来架构升级 |
| 替换 Chroma 为 LangChain 集成 | 增加依赖但不增加价值，现有直接客户端工作良好 |
| 替换 SiliconFlow embedding | 同上，保留现有实现 |
| 重写 prompt 文件 | 内容不变，可选包装为 `ChatPromptTemplate` 但非必须 |
| 改变 API 契约 | `POST /chat`、`GET /history`、`POST /reset` 的请求/响应格式不变 |

---

## 12. 术语表

| 术语 | 含义（本项目语境） |
|------|----------------|
| **StateGraph** | LangGraph 的核心类，用于定义由节点和边组成的有向图 |
| **Annotation** | LangGraph 的状态定义机制，类似 TypeScript 类型 + 运行时合并规则 |
| **Node** | 图中的一个处理步骤，是一个接收 State 并返回部分 State 更新的函数 |
| **Edge** | 节点之间的连接，定义执行顺序 |
| **Conditional Edge** | 根据状态动态决定下一个节点的边 |
| **Cycle** | 图中的循环路径（如 callLLM ↔ executeTools） |
| **Reducer** | 定义 State 字段如何合并多次更新的函数（如 messages 列表的追加） |
| **Fan-out / Fan-in** | 一个节点后并行触发多个节点（fan-out），多个节点完成后汇合（fan-in） |
| **Compile** | 将 StateGraph 定义编译为可执行的 Runnable |
| **Invoke** | 同步执行整张图，等待最终 State |
| **Stream** | 流式执行图，逐步返回节点执行结果或 token |
| **Checkpointer** | LangGraph 的持久化机制，用于保存图的执行快照（本次不使用） |

---

## 附录 A：文件结构变更预览

```
src/
├── graph/                     ← 新增目录
│   ├── state.ts               ← TutorState Annotation 定义
│   ├── index.ts               ← 图组装和 compile
│   ├── adapters.ts            ← BaseMessage ↔ ChatCompletionMessageParam 转换
│   └── nodes/                 ← 各节点实现
│       ├── classify.ts
│       ├── compress.ts
│       ├── build-prompt.ts
│       ├── call-llm.ts
│       ├── execute-tools.ts
│       └── respond.ts
├── services/
│   └── chat-service.ts        ← 简化为 graph.invoke() 的薄包装
├── classifier.ts              ← 保留核心逻辑，被 nodes/classify.ts 调用
├── prompts/                   ← 不变
├── tools/
│   └── dictionary.ts          ← StructuredTool 改造
├── rag/                       ← 不变
├── db/                        ← 不变
├── routes/                    ← 微调调用方式
└── ...
```

---

## 附录 B：分阶段时间线建议

| 阶段 | 预估工作量 | 前置条件 |
|------|-----------|---------|
| 迁移 Phase 0 | 1-2 天 | 无 |
| 迁移 Phase 1 | 2-3 天 | Phase 0 完成 |
| 迁移 Phase 2 | 1-2 天 | Phase 1 完成 |
| 迁移 Phase 3 | 1-2 天 | Phase 2 完成 |
| 迁移 Phase 4 | 1 天 | Phase 3 完成 |

总计约 **6-10 天**（含学习时间），可根据实际节奏调整。每个阶段之间可以有间隔，系统始终保持可用状态。
