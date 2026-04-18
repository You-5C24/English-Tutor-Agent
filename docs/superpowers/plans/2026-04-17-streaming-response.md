# Phase 4：Streaming 响应 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 English Tutor Agent 增加基于 SSE 的逐 token 流式响应体验（含停止按钮、场景徽章、完整回合一致性）；JSON 路径保持不变作为代码层降级。

**Architecture:** 后端新增 `POST /api/chat/stream` 路由 + `chatStream()` async-generator 服务（消费 `tutorGraph.streamEvents` 并在图完成后于同一个事务中落库）；前端新增 `streamChatMessage()` 协议层（`fetch + ReadableStream` 严格解析 SSE）+ `useConversation` hook 内根据 `VITE_STREAMING` 分支。LangGraph 图本体零改动。

**Tech Stack:** Node 22 + Fastify 5 + `@langchain/langgraph` 1.x（`streamEvents v2`）+ `AbortSignal` + SQLite；React 19 + Vite 8 + `fetch + ReadableStream` + `TextDecoder`；Vitest 4（后端 `fastify.inject` + `vi.mock('@/llm/model')`；前端 hook 集成测试）。

**Spec:** `docs/superpowers/specs/2026-04-17-streaming-response-design.md`

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/graph/verify-streaming.ts` | Modify | 扩展为 spike 脚本，探测 `on_chain_end` 字段与 `AbortSignal` 传播 |
| `src/services/sse-protocol.ts` | Create | `StreamEvent` 类型 + `serializeSSE(event)` 纯函数 |
| `src/services/__tests__/sse-protocol.test.ts` | Create | 纯函数测试（帧格式、特殊字符转义、不变量） |
| `src/services/chat-stream-service.ts` | Create | `chatStream()` async generator：事件映射 + 持久化 + abort / error 分类 |
| `src/services/__tests__/chat-stream-service.test.ts` | Create | 4 大场景：happy path / abort / LLM 错误 / 持久化错误 |
| `src/db/__tests__/test-helpers.ts` | Create | 抽取 `initTestDb()` 供 service 层测试复用（沿用 message-repo.test.ts 的 in-memory + closeDb 模式） |
| `src/routes/chat.ts` | Modify | 新增 `POST /chat/stream` 路由（SSE 握手 + `request.raw` close 透传 abort）；`POST /chat` 不动 |
| `src/routes/__tests__/chat-stream.test.ts` | Create | 路由集成：`fastify.inject` 读 SSE 响应 + 断言 DB 行 |
| `web/src/types/chat.ts` | Modify | 新增 `StreamEvent` 类型、`StreamCallbacks` 接口 |
| `web/src/api/chat.ts` | Modify | 新增 `streamChatMessage()`；`sendChatMessage()` 不动 |
| `web/src/api/__tests__/chat-stream.test.ts` | Create | SSE 解析 / 回调分派 / abort / 非 SSE 响应兜底 |
| `web/src/hooks/useConversation.ts` | Modify | 加入状态机：流式气泡 append / 中止清理 / feature flag 分支；导出 `stop()` |
| `web/src/hooks/__tests__/useConversation.streaming.test.ts` | Create | 会话状态机：meta / token / done / error / abort |
| `web/src/components/ChatInput.tsx` | Modify | 流式期间输入框不 disable；发送按钮在 `isStreaming` 时切"停止" |
| `web/src/components/MessageList.tsx` | Modify | 流式气泡显示打字光标（替代底部"正在思考..."占位） |
| `web/src/components/MessageBubble.tsx` | Modify | 消息头部展示 `scenario` 徽章（仅 assistant） |
| `web/src/components/ChatWindow.tsx` | Modify | 串起 `isStreaming` / `onStop`；中止后 2s transient "已停止" |
| `web/src/types/env.d.ts` | Create | `VITE_STREAMING` 环境变量类型声明 |
| `.env.example` | Modify（若存在）或 Create | 记录 `VITE_STREAMING` 默认值 |
| `README.md`（可选） | Modify | 记录新接口与 feature flag |

**不改动的文件：** `src/graph/**`（除 verify-streaming 外）、`src/db/**`、`src/services/chat-service.ts`、`src/services/session-manager.ts`、`src/app.ts`、前端 `ChatWindow` 的布局结构、所有既有测试。

---

## Task 1: 扩展 `verify-streaming.ts` 作为 Spike

> 目的：在真正动手前，验证 spec §10 的两个关键假设是否成立。结论写入 `docs/superpowers/plans/2026-04-17-streaming-response-notes.md`（后续任务参考），若某假设不成立则在对应任务里按 Fallback 调整。

**Files:**
- Modify: `src/graph/verify-streaming.ts`
- Create: `docs/superpowers/plans/2026-04-17-streaming-response-notes.md`

- [ ] **Step 1: 扩展 verify-streaming.ts 打印关键事件的 data.output 字段**

在现有 `verifyStreamEvents()` 之后追加一个 `verifyFinalStateAndAbort()` 函数：

```ts
/** 核查 A：节点级 on_chain_end 是否带齐 chatStream 持久化所需的字段 */
async function verifyFinalStateFromEvents() {
  console.log('\n=== 核查：节点级 on_chain_end 能否凑齐最终 state ===');
  const stream = tutorGraph.streamEvents(testInput, { version: 'v2' });
  const captured: Record<string, unknown> = {};
  for await (const event of stream) {
    if (event.event === 'on_chain_end') {
      const name = event.name;
      if (['classify', 'compress', 'respond', 'LangGraph'].includes(name)) {
        captured[name] = event.data?.output;
        console.log(`  [on_chain_end] ${name}:`, Object.keys((event.data?.output ?? {}) as object));
      }
    }
  }
  const root = captured['LangGraph'] as Record<string, unknown> | undefined;
  console.log('\n  root output keys:', root ? Object.keys(root) : '(missing)');
  console.log('  结论提示：chatStream() 可直接从以下来源组装 done 事件字段');
  console.log('    - scenario:           classify.output.scenario 或 root.scenario');
  console.log('    - reply:              respond.output.reply 或 root.reply');
  console.log('    - compressedHistory:  compress.output.compressedHistory 或 root.compressedHistory');
  console.log('    - compressedSummary:  compress.output.compressedSummary 或 root.compressedSummary');
}

/** 核查 B：向 streamEvents 传入 AbortSignal 是否能让其尽快中止并抛 AbortError */
async function verifyAbortSignalPropagation() {
  console.log('\n=== 核查：AbortSignal 是否被 streamEvents 尊重 ===');
  const controller = new AbortController();
  const stream = tutorGraph.streamEvents(testInput, {
    version: 'v2',
    signal: controller.signal,
  });
  let eventCount = 0;
  try {
    for await (const event of stream) {
      eventCount++;
      if (event.event === 'on_chat_model_stream' && eventCount > 2) {
        console.log('  触发 abort...');
        controller.abort();
      }
    }
    console.log(`  [WARN] 迭代自然结束（共 ${eventCount} 个事件），未抛 AbortError`);
  } catch (err) {
    const name = (err as Error).name;
    console.log(`  ✓ 迭代终止，抛错类型：${name}`);
  }
}
```

并在 `main()` 里追加两行调用。

- [ ] **Step 2: 运行 spike 脚本，记录关键结论**

```bash
npx tsx --env-file=.env src/graph/verify-streaming.ts
```

Expected：控制台打印每个节点 `on_chain_end` 的 `output` 字段列表，以及 abort 后的终止行为。

- [ ] **Step 3: 把核查结论写入 notes 文件**

新建 `docs/superpowers/plans/2026-04-17-streaming-response-notes.md`，至少记录：
- 能否从 **root `on_chain_end`** 一次性拿齐 `scenario / reply / compressedHistory / compressedSummary`
- 若不能，各字段应分别从哪个节点的 `on_chain_end` 收集
- 传入 `signal` 后图能否中止；抛的错误类型是什么（`AbortError` / `Error`）
- 触发 abort 的**最小时延**（近似值，帮助后续调参）

后续任务中 chatStream() 的字段收集策略以 notes 为准。

- [ ] **Step 4: Commit**

```bash
git add src/graph/verify-streaming.ts docs/superpowers/plans/2026-04-17-streaming-response-notes.md
git commit -m "chore(streaming): extend verify-streaming spike with state + abort probes"
```

---

## Task 2: SSE 协议纯函数 + 类型

**Files:**
- Create: `src/services/sse-protocol.ts`
- Create: `src/services/__tests__/sse-protocol.test.ts`

- [ ] **Step 1: 写失败测试覆盖 serializeSSE 的所有事件形状**

`src/services/__tests__/sse-protocol.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { serializeSSE, type StreamEvent } from '@/services/sse-protocol';

describe('serializeSSE', () => {
  it('encodes meta event with scenario', () => {
    const evt: StreamEvent = { type: 'meta', scenario: 'VOCABULARY' };
    expect(serializeSSE(evt)).toBe(
      'event: meta\ndata: {"scenario":"VOCABULARY"}\n\n'
    );
  });

  it('encodes token event with delta', () => {
    const evt: StreamEvent = { type: 'token', delta: 'Hello' };
    expect(serializeSSE(evt)).toBe('event: token\ndata: {"delta":"Hello"}\n\n');
  });

  it('escapes newlines inside delta to satisfy single-line JSON', () => {
    const evt: StreamEvent = { type: 'token', delta: 'line1\nline2' };
    const out = serializeSSE(evt);
    expect(out).toBe('event: token\ndata: {"delta":"line1\\nline2"}\n\n');
    expect(out.split('\n\n')).toHaveLength(2);
  });

  it('encodes done event with messageId / scenario / replyLength', () => {
    const evt: StreamEvent = {
      type: 'done',
      messageId: 'm1',
      scenario: 'GRAMMAR_CORRECTION',
      replyLength: 42,
    };
    expect(serializeSSE(evt)).toBe(
      'event: done\ndata: {"messageId":"m1","scenario":"GRAMMAR_CORRECTION","replyLength":42}\n\n'
    );
  });

  it('encodes error event with code / message', () => {
    const evt: StreamEvent = { type: 'error', code: 'LLM_ERROR', message: 'oops' };
    expect(serializeSSE(evt)).toBe(
      'event: error\ndata: {"code":"LLM_ERROR","message":"oops"}\n\n'
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- src/services/__tests__/sse-protocol.test.ts
```

Expected: FAIL，文件不存在 / 导出找不到。

- [ ] **Step 3: 实现 serializeSSE + StreamEvent 类型**

`src/services/sse-protocol.ts`：

```ts
import type { Scenario } from '@/classifier';

/** Phase 4 SSE 事件集合（详见 spec §4.3） */
export type StreamEvent =
  | { type: 'meta'; scenario: Scenario }
  | { type: 'token'; delta: string }
  | { type: 'done'; messageId: string; scenario: Scenario; replyLength: number }
  | { type: 'error'; code: string; message: string };

/**
 * 按严格 SSE 规范把 StreamEvent 序列化为一帧字节文本。
 * - 帧以 \n\n 结束
 * - data 字段必须单行；JSON.stringify 会把 \n 转义为 \\n，天然满足
 * - type 字段被抽出到 event 行，剩余字段原样进 data JSON
 */
export function serializeSSE(event: StreamEvent): string {
  const { type, ...payload } = event;
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- src/services/__tests__/sse-protocol.test.ts
```

Expected: PASS，5 条用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/services/sse-protocol.ts src/services/__tests__/sse-protocol.test.ts
git commit -m "feat(streaming): add SSE protocol types and serializer"
```

---

## Task 3: chatStream — Happy Path（meta → tokens → done + 持久化）

**Files:**
- Create: `src/services/chat-stream-service.ts`
- Create: `src/services/__tests__/chat-stream-service.test.ts`
- Create: `src/db/__tests__/test-helpers.ts`（见 Step 1）

> **Mock 策略（临时）**：Task 3–6 当前采用"**上层 mock**"——通过 `vi.mock('@/graph/index')` 把 `tutorGraph` 整体替换为可控的 async generator。这样测试自给自足，但 **绕过了真实 LangGraph 事件流**，无法覆盖 spec §4.5 的事件映射真实形状。
>
> **⚠️ 遗留动作（Task 1 spike 完成后必须回查）**：
> spec §2/§8.2 的关键决策是 `vi.mock('@/llm/model')`——这意味着 Task 3–6 的"最终形态"应该在保留真实 `tutorGraph` 的前提下，只替换底层 `chatModel.invoke / chatModel.stream`。
>
> 本 plan 选择先用上层 mock 快速跑通骨架，**待 Task 1 的 `notes.md` 落地、真实事件 shape 被确认后**，由后续独立 commit 做一次"mock 下沉"：把 Task 3–6 的测试 mock 改为 `vi.mock('@/llm/model')` + 真实 `tutorGraph.streamEvents`。本 plan **不在当前修订内**完成这一步，但 **Task 15 的回归验证必须显式检查**：
> - [ ] TODO（post-Task 1）：记录 mock 下沉的跟进 issue / PR，或在本文件末尾追加 Task 16
>
> **DB**：使用 in-memory SQLite，复用 `src/db/__tests__/test-helpers.ts` 的 `initTestDb()`（在本 Task Step 1 创建）。

- [ ] **Step 0: 与 Task 1 notes 对齐 fake 事件 shape（阻塞性前置）**

本 Task 后续所有 fake 事件的 shape（`{ event: 'on_chain_end', name: 'classify', data: { output: { scenario: ... } } }` 等）是**基于作者的合理假设**。进入 Step 1 前先打开 `docs/superpowers/plans/2026-04-17-streaming-response-notes.md`，逐项核对：

- 若 `classify` 的 `on_chain_end.data.output` 实际是 `{ scenario: 'VOCABULARY' }`：**保持当前 fake 事件不变**。
- 若实际 shape 不同（例如是 `{ classify: { scenario: ... } }` 或整个 state 快照）：**先同步修改 Step 1 的 fake 事件 + Step 3 chatStream 实现里对应的 if 分支 + 字段抽取逻辑**，再进入 Step 1。
- 若 Task 1 发现图根本不发 `on_chain_end` / 字段缺失：**停止并回到 PLAN 模式调整策略**（可能需要改为并行订阅 `stream("values")` 兜底，详见 spec §10）。

其它节点（`compress` / `respond`）同样核对。此 Step 无需代码改动，仅需在 notes 中勾选"shape 已对齐"。

- [ ] **Step 1: 写失败测试：happy path 产生正确的 StreamEvent 序列 + DB 落两行**

`src/services/__tests__/chat-stream-service.test.ts`（happy path 部分）：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StreamEvent } from '@/services/sse-protocol';
import { initTestDb } from '@/db/__tests__/test-helpers'; // 若无则临时 inline

// 用一个可配置的伪事件流替换 tutorGraph。
// ⚠️ vi.mock 被 Vitest hoist 到文件顶部，工厂函数闭包若直接引用模块级 let/const 会触发
//     ReferenceError（TDZ）。必须用 vi.hoisted 让变量同样 hoist。
const { fakeEvents } = vi.hoisted(() => ({ fakeEvents: [] as unknown[] }));

vi.mock('@/graph/index', () => ({
  tutorGraph: {
    streamEvents: vi.fn((_input: unknown, opts: { signal?: AbortSignal } = {}) =>
      (async function* () {
        for (const e of fakeEvents) {
          if (opts.signal?.aborted) {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          yield e;
        }
      })()
    ),
  },
}));

import { chatStream } from '@/services/chat-stream-service';
import * as messageRepo from '@/db/message-repo';
import * as sessionManager from '@/services/session-manager';
import { initTestDb, closeDb } from '@/db/__tests__/test-helpers';

beforeEach(() => {
  fakeEvents.length = 0;
  initTestDb();                  // 清表 + schema
  sessionManager.clearDefaultSession();
  sessionManager.initDefaultSession();
});

afterEach(() => {
  closeDb();
});

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const evt of iter) out.push(evt);
  return out;
}

describe('chatStream — happy path', () => {
  it('emits meta → tokens → done and persists user + assistant rows', async () => {
    // 注：chatStream 实现只消费 classify / compress / respond 的 on_chain_end；
    //    根图的 on_chain_end 当前不参与字段收集，因此不在 fakeEvents 中构造。
    fakeEvents.push(
      { event: 'on_chain_end', name: 'classify', data: { output: { scenario: 'VOCABULARY' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'Hel' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'lo' } } },
      { event: 'on_chain_end', name: 'compress', data: { output: { compressedHistory: [], compressedSummary: '' } } },
      { event: 'on_chain_end', name: 'respond', data: { output: { reply: 'Hello' } } },
    );

    const session = sessionManager.getDefaultSession();
    const controller = new AbortController();
    const events = await collect(chatStream(session, 'hi', controller.signal));

    expect(events[0]).toEqual({ type: 'meta', scenario: 'VOCABULARY' });
    expect(events.filter((e) => e.type === 'token').map((e) => (e as { delta: string }).delta)).toEqual(['Hel', 'lo']);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', scenario: 'VOCABULARY', replyLength: 5 });
    expect((done as { messageId: string }).messageId).toMatch(/.+/);

    const rows = messageRepo.getRecentMessages();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(rows[1]).toMatchObject({ role: 'assistant', content: 'Hello', scenario: 'VOCABULARY' });
  });
});
```

**同步创建 `src/db/__tests__/test-helpers.ts`**（File Map 已列出；内容固定）：

```ts
import { initDb, closeDb } from '@/db/database';

/**
 * 为 service 层测试准备一份干净的 in-memory DB；调用方应在 afterEach/afterAll 中 closeDb()。
 * 与 `src/db/__tests__/message-repo.test.ts` 的 initDb(':memory:') 语义完全一致，
 * 抽出成帮助函数只是为了复用。
 */
export function initTestDb(): void {
  closeDb();           // 若上一用例未关，先关；幂等
  initDb(':memory:');
}

export { closeDb };
```

测试文件在 `beforeEach` 调 `initTestDb()`、`afterEach` 调 `closeDb()` 即可。

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- src/services/__tests__/chat-stream-service.test.ts
```

Expected: FAIL，`chatStream` 未导出。

- [ ] **Step 3: 实现 chatStream 骨架（happy path + 持久化）**

`src/services/chat-stream-service.ts`：

```ts
import { randomUUID } from 'node:crypto';
import type { BaseMessage } from '@langchain/core/messages';
import { tutorGraph } from '@/graph/index';
import { sessionHistoryToBaseMessages, baseMessagesToSessionHistory } from '@/graph/adapters';
import { runTransaction } from '@/db/database';
import * as messageRepo from '@/db/message-repo';
import * as sessionManager from '@/services/session-manager';
import type { Session } from '@/types/session';
import type { Scenario } from '@/classifier';
import type { StreamEvent } from '@/services/sse-protocol';

interface CollectedState {
  scenario?: Scenario;
  reply: string;
  compressedHistory?: unknown[];
  compressedSummary?: string;
}

function newMessageId(): string {
  return randomUUID();
}

/**
 * 把 LangGraph streamEvents 映射为 Phase 4 的 StreamEvent 序列，并在图正常结束后
 * 一次性在事务中落库（与现有 chat() 语义等价）。
 *
 * 不变量：
 * - 正常路径：meta(可选) → token* → done
 * - 合法中止：不 yield 终态帧（静默结束）
 * - 失败：yield error，且不落库
 */
export async function* chatStream(
  session: Session,
  userMessage: string,
  signal: AbortSignal
): AsyncIterable<StreamEvent> {
  const input = {
    userMessage,
    history: sessionHistoryToBaseMessages(session.history),
    summary: session.summary,
  };

  const collected: CollectedState = { reply: '' };
  let metaEmitted = false;

  const stream = tutorGraph.streamEvents(input, { version: 'v2', signal });

  for await (const event of stream as AsyncIterable<{
    event: string;
    name?: string;
    data?: { chunk?: { content?: unknown }; output?: Record<string, unknown> };
  }>) {
    if (event.event === 'on_chat_model_stream') {
      const raw = event.data?.chunk?.content;
      const delta = typeof raw === 'string' ? raw : '';
      if (delta.length > 0) {
        collected.reply += delta;
        yield { type: 'token', delta };
      }
    } else if (event.event === 'on_chain_end') {
      const out = event.data?.output ?? {};
      if (event.name === 'classify' && !metaEmitted) {
        const scenario = out.scenario as Scenario | undefined;
        if (scenario) {
          collected.scenario = scenario;
          metaEmitted = true;
          yield { type: 'meta', scenario };
        }
      } else if (event.name === 'compress') {
        collected.compressedHistory = out.compressedHistory as unknown[] | undefined;
        collected.compressedSummary = out.compressedSummary as string | undefined;
      } else if (event.name === 'respond') {
        const finalReply = out.reply as string | undefined;
        if (typeof finalReply === 'string' && finalReply.length > 0) {
          collected.reply = finalReply;
        }
      }
    }
  }

  // 图正常跑完后到达此处；异常路径由 Task 5 (LLM_ERROR) / Task 6 (PERSIST_ERROR) 处理。
  session.history = baseMessagesToSessionHistory(
    (collected.compressedHistory ?? []) as BaseMessage[]
  );
  session.summary = collected.compressedSummary ?? '';
  session.history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: collected.reply }
  );

  const userMessageId = newMessageId();
  const assistantMessageId = newMessageId();
  const now = Date.now();
  runTransaction(() => {
    sessionManager.save();
    messageRepo.addMessage({
      id: userMessageId,
      role: 'user',
      content: userMessage,
      scenario: null,
      timestamp: now - 1,
    });
    messageRepo.addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: collected.reply,
      scenario: collected.scenario ?? null,
      timestamp: now,
    });
  });

  yield {
    type: 'done',
    messageId: assistantMessageId,
    scenario: (collected.scenario ?? 'OFF_TOPIC') as Scenario,
    replyLength: collected.reply.length,
  };
}
```

> **Spike 对齐**：若 Task 1 notes 显示 root `on_chain_end` 能直接拿全最终 state，可以改写成只消费 root 事件；本实现按"节点级聚合"写，更健壮，也更贴近 spec §4.5 的映射表。

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- src/services/__tests__/chat-stream-service.test.ts
```

Expected: PASS，happy path 用例绿。

- [ ] **Step 5: Commit**

```bash
git add src/services/chat-stream-service.ts src/services/__tests__/chat-stream-service.test.ts
git commit -m "feat(streaming): add chatStream service with happy path + persistence"
```

---

## Task 4: chatStream — Abort 不落库

**Files:**
- Modify: `src/services/__tests__/chat-stream-service.test.ts`
- Modify: `src/services/chat-stream-service.ts`

- [ ] **Step 1: 写失败测试：中途 abort 时不 yield 终态帧且 DB 无新行**

在同一个测试文件追加：

```ts
describe('chatStream — abort', () => {
  it('stops silently and does not persist when signal aborts mid-stream', async () => {
    let aborted = false;
    // 默认 mock 工厂（见 Task 3 Step 1）已按 signal.aborted 抛 AbortError，这里只需投喂事件即可。
    fakeEvents.push(
      { event: 'on_chain_end', name: 'classify', data: { output: { scenario: 'VOCABULARY' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'He' } } }
    );

    const session = sessionManager.getDefaultSession();
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    const iter = chatStream(session, 'hi', controller.signal)[Symbol.asyncIterator]();

    // 消费几个事件后 abort
    events.push((await iter.next()).value as StreamEvent);   // meta
    events.push((await iter.next()).value as StreamEvent);   // token 'He'
    controller.abort();
    aborted = true;

    try {
      for (let r = await iter.next(); !r.done; r = await iter.next()) {
        events.push(r.value);
      }
    } catch {
      /* 允许冒出 AbortError；chatStream 也可选择静默吞掉 */
    }

    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(messageRepo.getRecentMessages()).toHaveLength(0);
    expect(aborted).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- src/services/__tests__/chat-stream-service.test.ts
```

Expected: FAIL，当前实现会在 abort 时冒出 `AbortError` 到外层。

- [ ] **Step 3: 在 chatStream 中把 AbortError 吞掉（静默结束）**

把 Task 3 中的 for-await 包进 try/catch：

```ts
try {
  for await (const event of stream as AsyncIterable<...>) {
    // 同上
  }
} catch (err) {
  const e = err as Error;
  // 主判据：我们自己持有的 signal 是否已中止（对底层抛错类型做兼容，不依赖具体错误名）。
  // 次判据：底层显式声明 AbortError（覆盖 "signal 未被设置、但迭代器内部自行抛 AbortError" 的边缘情况）。
  if (signal.aborted || e.name === 'AbortError') {
    return;  // 合法中止：不 yield 终态帧、不落库
  }
  throw err; // 交给 Task 5 的 error 分类
}
```

注意：**持久化块必须留在 try 之外、且在正常路径才执行**。把持久化 + `yield done` 放在 try 后、函数尾部，确保只有在 `for-await` 正常退出时才运行。

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- src/services/__tests__/chat-stream-service.test.ts
```

Expected: PASS，两条用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/services/chat-stream-service.ts src/services/__tests__/chat-stream-service.test.ts
git commit -m "feat(streaming): honor AbortSignal and skip persistence on abort"
```

---

## Task 5: chatStream — LLM / 内部错误分类

**Files:**
- Modify: `src/services/__tests__/chat-stream-service.test.ts`
- Modify: `src/services/chat-stream-service.ts`

- [ ] **Step 1: 写失败测试：LLM 异常映射为 `error` 帧（code=LLM_ERROR）且不落库**

```ts
describe('chatStream — LLM error', () => {
  it('emits error event with LLM_ERROR and does not persist', async () => {
    vi.mocked((await import('@/graph/index')).tutorGraph.streamEvents).mockImplementationOnce(
      () =>
        (async function* () {
          yield { event: 'on_chain_end', name: 'classify', data: { output: { scenario: 'VOCABULARY' } } };
          yield { event: 'on_chat_model_stream', data: { chunk: { content: 'He' } } };
          throw new Error('LLM upstream failure');
        })()
    );

    const session = sessionManager.getDefaultSession();
    const events = await collect(chatStream(session, 'hi', new AbortController().signal));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'LLM_ERROR' });
    expect(messageRepo.getRecentMessages()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 在 chatStream 的 catch 里分类错误并 yield error**

```ts
} catch (err) {
  const e = err as Error;
  if (signal.aborted || e.name === 'AbortError') return;

  // 分类策略（对齐 spec §7）：
  // - 图/LLM 运行时抛 → LLM_ERROR（覆盖 TOOL_ERROR 场景，见下方"范围说明"）
  // - chatStream 自身 bug（极少数：字段访问异常、类型错误）→ INTERNAL
  // 判据：通过 for-await 冒上来的是 LangGraph 链内的错误；chatStream 外层的同步代码
  //      尚未执行到此 catch（持久化 catch 在 Task 6 单独处理）。故这里统一认为是 LLM_ERROR。
  const code: 'LLM_ERROR' | 'INTERNAL' =
    e.name === 'TypeError' || e.name === 'ReferenceError' ? 'INTERNAL' : 'LLM_ERROR';

  yield {
    type: 'error',
    code,
    message: e.message ?? 'upstream failure',
  };
  return;
}
```

> **范围注意（对齐 spec §7）**：
> - `LLM_ERROR`：默认分类，覆盖所有从图内冒出的运行时错误（包括实际由 `executeTools` 节点抛出的 `TOOL_ERROR`）。
> - `INTERNAL`：仅当异常类型明显为 JS 编程错误（`TypeError` / `ReferenceError`）时触发；真实使用中应极为罕见。
> - `TOOL_ERROR`：**显式推迟**。区分该码需要 LangGraph 事件携带抛出节点名（可通过订阅 `on_chain_error`/`on_tool_error` 事件捕获）。这是一次**对 spec §7 表格的降级**，需同步到 `docs/superpowers/specs/2026-04-17-streaming-response-design.md` §2 "关键决策汇总"表中补一行，或在 §7 表格下加一条脚注："Phase 4 实现层面暂合并 TOOL_ERROR 到 LLM_ERROR，待后续独立迭代拆分"。
>
> - [ ] **同步 spec 文档**：Task 5 完成后，更新 spec §7 加入上述脚注并 commit（commit 范围：只改 spec，不含代码）。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add src/services/chat-stream-service.ts src/services/__tests__/chat-stream-service.test.ts
git commit -m "feat(streaming): emit error event on graph exceptions"
```

---

## Task 6: chatStream — PERSIST_ERROR（事务失败）

**Files:**
- Modify: `src/services/__tests__/chat-stream-service.test.ts`
- Modify: `src/services/chat-stream-service.ts`

- [ ] **Step 1: 写失败测试：事务抛时应 yield `error` (code=PERSIST_ERROR) 且不落库**

```ts
describe('chatStream — persist error', () => {
  it('emits PERSIST_ERROR when the transaction fails after graph succeeds', async () => {
    fakeEvents.push(
      { event: 'on_chain_end', name: 'classify', data: { output: { scenario: 'EXPRESSION' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'Hi' } } },
      { event: 'on_chain_end', name: 'compress', data: { output: { compressedHistory: [], compressedSummary: '' } } },
      { event: 'on_chain_end', name: 'respond', data: { output: { reply: 'Hi' } } },
      { event: 'on_chain_end', name: 'LangGraph', data: { output: { reply: 'Hi', scenario: 'EXPRESSION' } } },
    );

    vi.spyOn(messageRepo, 'addMessage').mockImplementation(() => {
      throw new Error('disk full');
    });

    const session = sessionManager.getDefaultSession();
    const events = await collect(chatStream(session, 'hi', new AbortController().signal));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'PERSIST_ERROR' });
    // 不应已经 yield 过 done
    expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 把持久化块单独 try/catch，失败时 yield PERSIST_ERROR**

```ts
try {
  runTransaction(() => { ... });
} catch (err) {
  yield {
    type: 'error',
    code: 'PERSIST_ERROR',
    message: (err as Error).message ?? 'persistence failed',
  };
  return;
}

yield { type: 'done', messageId, scenario: ..., replyLength: collected.reply.length };
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add src/services/chat-stream-service.ts src/services/__tests__/chat-stream-service.test.ts
git commit -m "feat(streaming): distinguish PERSIST_ERROR from LLM_ERROR"
```

---

## Task 7: 路由 `POST /chat/stream` — Happy Path

**Files:**
- Modify: `src/routes/chat.ts`
- Create: `src/routes/__tests__/chat-stream.test.ts`

- [ ] **Step 1: 写失败测试：用 fastify.inject 读取 SSE 响应、断言帧顺序和 DB 行数**

`src/routes/__tests__/chat-stream.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '@/app';
import * as sessionManager from '@/services/session-manager';
import * as messageRepo from '@/db/message-repo';
import { initTestDb } from '@/db/__tests__/test-helpers';

// chatStream mock：固定 yield 一组事件
vi.mock('@/services/chat-stream-service', () => ({
  chatStream: vi.fn(async function* () {
    yield { type: 'meta', scenario: 'VOCABULARY' };
    yield { type: 'token', delta: 'Hello' };
    yield { type: 'done', messageId: 'abc', scenario: 'VOCABULARY', replyLength: 5 };
  }),
}));

beforeEach(() => {
  initTestDb();
  sessionManager.clearDefaultSession();
  sessionManager.initDefaultSession();
});

describe('POST /api/chat/stream — happy path', () => {
  it('writes SSE frames with correct headers and ordering', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: { message: 'hi' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const body = res.body;
    expect(body).toContain('event: meta');
    expect(body).toContain('event: token');
    expect(body).toContain('event: done');

    // 帧顺序：meta 必须在首个 token 之前；done 在最后
    const iMeta = body.indexOf('event: meta');
    const iToken = body.indexOf('event: token');
    const iDone = body.indexOf('event: done');
    expect(iMeta).toBeGreaterThanOrEqual(0);
    expect(iMeta).toBeLessThan(iToken);
    expect(iToken).toBeLessThan(iDone);

    await app.close();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- src/routes/__tests__/chat-stream.test.ts
```

Expected: FAIL，`/api/chat/stream` 404。

- [ ] **Step 3: 在 `src/routes/chat.ts` 中新增 `POST /chat/stream` 路由**

```ts
import { chatStream } from '@/services/chat-stream-service';
import { serializeSSE } from '@/services/sse-protocol';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

app.post<{ Body: ChatBody }>(
  '/chat/stream',
  {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string', minLength: 1, maxLength: 5000 } },
      },
    },
  },
  async (request, reply) => {
    const { message } = request.body;
    const session = sessionManager.getDefaultSession();

    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);

    const controller = new AbortController();
    request.raw.on('close', () => controller.abort());

    // 不变量守护：spec §4.4 "终态二选一，仅 1 次"。若 chatStream 已 yield 过 done/error，
    // 即使路由层 catch 到异常也不再补发 error 帧，避免双终态。
    let emittedTerminal = false;

    try {
      for await (const evt of chatStream(session, message, controller.signal)) {
        if (evt.type === 'done' || evt.type === 'error') {
          emittedTerminal = true;
        }
        reply.raw.write(serializeSSE(evt));
      }
    } catch (err) {
      request.log.error(err, 'streaming chat route failed');
      if (!emittedTerminal && !controller.signal.aborted) {
        reply.raw.write(
          serializeSSE({ type: 'error', code: 'INTERNAL', message: 'internal error' })
        );
      }
    } finally {
      reply.raw.end();
    }
  }
);
```

> **注意**：`reply.hijack()` 告诉 Fastify 不要自动序列化响应；之后需手动 `reply.raw.end()`。

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- src/routes/__tests__/chat-stream.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat.ts src/routes/__tests__/chat-stream.test.ts
git commit -m "feat(streaming): add POST /api/chat/stream route with SSE frames"
```

---

## Task 8: 路由 — Abort 语义贯通

**Files:**
- Modify: `src/routes/__tests__/chat-stream.test.ts`

> **说明**：abort 流程（`request.raw.close → AbortController → chatStream signal`）在 Task 7 已接好；本任务只**补测**以防回归。

- [ ] **Step 1: 写测试：模拟客户端中途关闭连接，断言 chatStream 收到 abort 信号**

```ts
describe('POST /api/chat/stream — abort', () => {
  it('aborts downstream when the HTTP connection closes', async () => {
    const seenSignals: AbortSignal[] = [];
    const chatStreamMod = await import('@/services/chat-stream-service');
    vi.mocked(chatStreamMod.chatStream).mockImplementationOnce(
      (async function* (_session, _msg, signal) {
        seenSignals.push(signal);
        yield { type: 'meta', scenario: 'VOCABULARY' };
        // 模拟一个长时间运行的生成器
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by signal')));
        });
      }) as typeof chatStreamMod.chatStream
    );

    const app = buildApp();
    const req = app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: { message: 'hi' },
    });

    // Fastify light-my-request 不直接暴露连接关闭；这里用超时断开近似
    // 更实用：用真实 HTTP server + 手动 destroy socket。保持示例在 inject 级别。
    const res = await req;
    expect(res.statusCode).toBe(200);
    expect(seenSignals).toHaveLength(1);
    await app.close();
  });
});
```

> **范围说明**：`fastify.inject` 不模拟真实 socket close；要精确验证 close → abort，可在 Step 2 改为启动真实 server。如果工作量过大，保留"signal 被传入且存活"这一级断言即可，更精细的集成可留给手动验证。

- [ ] **Step 2: 用真实 `app.listen()` + `http.request` 断言 abort 真实触发（必做）**

`fastify.inject` 无法模拟 socket close，必须起真实端口才能验证 abort 信号的端到端传播。追加一条用例：

```ts
import http from 'node:http';

describe('POST /api/chat/stream — real socket abort', () => {
  it('propagates abort to chatStream when the client destroys the socket', async () => {
    let capturedSignal: AbortSignal | undefined;
    const pendingResolvers: Array<() => void> = [];
    const chatStreamMod = await import('@/services/chat-stream-service');

    vi.mocked(chatStreamMod.chatStream).mockImplementationOnce(
      (async function* (_session, _msg, signal) {
        capturedSignal = signal;
        yield { type: 'meta', scenario: 'VOCABULARY' };
        // 长时间挂起，等待 signal 触发
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
          pendingResolvers.push(resolve);
        });
      }) as typeof chatStreamMod.chatStream
    );

    const app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no port bound');
    const port = address.port;

    await new Promise<void>((resolveTest, rejectTest) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/chat/stream',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf-8');
            if (text.includes('event: meta')) {
              // 收到首帧后立即断开 socket
              req.destroy();
            }
          });
          res.on('error', () => { /* destroy 会导致 res 报错，忽略 */ });
        }
      );
      req.on('error', () => { /* destroy 后 req 报错属预期 */ });
      req.write(JSON.stringify({ message: 'hi' }));
      req.end();

      // 给后端 200ms 消化 socket close → AbortController.abort()
      setTimeout(() => {
        try {
          expect(capturedSignal?.aborted).toBe(true);
          resolveTest();
        } catch (err) {
          rejectTest(err);
        }
      }, 200);
    });

    // 清理：确保 pending generator 被释放
    pendingResolvers.forEach((r) => r());
    await app.close();
  });
});
```

Expected：`capturedSignal.aborted === true`。

- [ ] **Step 3: 运行测试确认通过**

```bash
npm run test -- src/routes/__tests__/chat-stream.test.ts
```

Expected: 两条用例（inject 版 + real-socket 版）全绿。

- [ ] **Step 4: Commit**

```bash
git add src/routes/__tests__/chat-stream.test.ts
git commit -m "test(streaming): cover abort propagation from HTTP close to chatStream"
```

---

## Task 9: 前端类型 + feature flag 声明

**Files:**
- Modify: `web/src/types/chat.ts`
- Create: `web/src/types/env.d.ts`

- [ ] **Step 1: 在 `web/src/types/chat.ts` 追加 StreamEvent / StreamCallbacks 类型**

```ts
export type StreamEvent =
  | { type: 'meta'; scenario: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; messageId: string; scenario: string; replyLength: number }
  | { type: 'error'; code: string; message: string };

export interface StreamCallbacks {
  onMeta?: (evt: { scenario: string }) => void;
  onToken?: (evt: { delta: string }) => void;
  onDone?: (evt: { messageId: string; scenario: string; replyLength: number }) => void;
  onError?: (evt: { code: string; message: string }) => void;
}

export interface StreamHandle {
  abort: () => void;
  /**
   * 流生命周期结束时 resolve（包括 done / stream-level error via onError / user abort）。
   *
   * **仅在以下情况 reject**（"pre-stream 协议错"）：
   * - HTTP 非 200；
   * - 响应 Content-Type 不是 `text/event-stream`（spec §7 前端协议契约）；
   * - fetch 本身抛（网络断开、CORS 等），且 `abort()` 未主动触发。
   *
   * 流内语义错误（`event: error`）统一通过 `onError` 回调分派，**不**使 `done` reject。
   */
  done: Promise<void>;
}
```

- [ ] **Step 2: 新建 `web/src/types/env.d.ts` 声明 `VITE_STREAMING`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STREAMING?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: 构建确认**

```bash
cd web && npm run build
```

Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add web/src/types/chat.ts web/src/types/env.d.ts
git commit -m "feat(streaming): add frontend StreamEvent / VITE_STREAMING types"
```

---

## Task 10: 前端流式 API 客户端 —— `streamChatMessage()`

**Files:**
- Modify: `web/src/api/chat.ts`
- Create: `web/src/api/__tests__/chat-stream.test.ts`

- [ ] **Step 1: 写失败测试覆盖 SSE 解析、回调分派、abort 和非 SSE 响应**

`web/src/api/__tests__/chat-stream.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamChatMessage, ChatApiError } from '@/api/chat';
import type { StreamCallbacks } from '@/types/chat';

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => mockFetch.mockReset());

describe('streamChatMessage', () => {
  it('invokes callbacks in order for meta / token / done', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseResponse([
        'event: meta\ndata: {"scenario":"VOCABULARY"}\n\n',
        'event: token\ndata: {"delta":"Hel"}\n\n',
        'event: token\ndata: {"delta":"lo"}\n\n',
        'event: done\ndata: {"messageId":"m1","scenario":"VOCABULARY","replyLength":5}\n\n',
      ])
    );
    const calls: string[] = [];
    const cbs: StreamCallbacks = {
      onMeta: (e) => calls.push(`meta:${e.scenario}`),
      onToken: (e) => calls.push(`token:${e.delta}`),
      onDone: (e) => calls.push(`done:${e.messageId}`),
      onError: (e) => calls.push(`error:${e.code}`),
    };
    const h = streamChatMessage({ message: 'hi' }, cbs);
    await h.done;
    expect(calls).toEqual(['meta:VOCABULARY', 'token:Hel', 'token:lo', 'done:m1']);
  });

  it('handles split frames across chunks', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseResponse([
        'event: tok',
        'en\ndata: {"delta',
        '":"ab"}\n\nevent: done\ndata: {"messageId":"m","scenario":"X","replyLength":2}\n\n',
      ])
    );
    const tokens: string[] = [];
    const h = streamChatMessage({ message: 'hi' }, { onToken: (e) => tokens.push(e.delta) });
    await h.done;
    expect(tokens).toEqual(['ab']);
  });

  it('throws ChatApiError for non-SSE error responses (pre-stream)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad', code: 'INVALID_REQUEST', statusCode: 400 }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const h = streamChatMessage({ message: '' }, {});
    await expect(h.done).rejects.toBeInstanceOf(ChatApiError);
  });

  it('stops parsing after abort() is called', async () => {
    const slow = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('event: meta\ndata: {"scenario":"VOCABULARY"}\n\n'));
        await new Promise((r) => setTimeout(r, 100));
        controller.enqueue(enc.encode('event: token\ndata: {"delta":"late"}\n\n'));
        controller.close();
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(slow, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const tokens: string[] = [];
    const h = streamChatMessage({ message: 'hi' }, { onToken: (e) => tokens.push(e.delta) });
    setTimeout(() => h.abort(), 10);
    await h.done;
    expect(tokens).not.toContain('late');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npm run test -- src/api/__tests__/chat-stream.test.ts
```

Expected: FAIL，`streamChatMessage` 未导出。

- [ ] **Step 3: 实现 streamChatMessage**

在 `web/src/api/chat.ts` 新增：

```ts
import type { StreamCallbacks, StreamEvent, StreamHandle, ErrorResponse } from '@/types/chat';

/** 最小 SSE 解析：按 '\n\n' 切帧，每帧按行解析 `event:` 和 `data:` */
function parseSseBuffer(buf: string): { frames: StreamEvent[]; rest: string } {
  const frames: StreamEvent[] = [];
  let rest = buf;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let eventName: string | undefined;
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // comment / heartbeat
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!eventName) continue;
    try {
      const payload = JSON.parse(data || '{}') as Record<string, unknown>;
      frames.push({ type: eventName, ...payload } as StreamEvent);
    } catch {
      /* 恶意/损坏帧忽略 */
    }
  }
  return { frames, rest };
}

export function streamChatMessage(
  req: { message: string },
  cbs: StreamCallbacks
): StreamHandle {
  const controller = new AbortController();

  const done = (async () => {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    // 协议契约：非 SSE 响应一律按 JSON 错误处理（spec §7 前端协议契约）
    const ct = res.headers.get('Content-Type') ?? '';
    if (!res.ok || !ct.includes('text/event-stream')) {
      const err = (await res.json().catch(() => null)) as ErrorResponse | null;
      throw new ChatApiError(
        err?.error ?? `HTTP ${res.status}`,
        err?.code ?? 'UNEXPECTED_RESPONSE',
        err?.statusCode ?? res.status
      );
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseBuffer(buf);
        buf = rest;
        for (const f of frames) {
          if (controller.signal.aborted) return;
          switch (f.type) {
            case 'meta': cbs.onMeta?.({ scenario: f.scenario }); break;
            case 'token': cbs.onToken?.({ delta: f.delta }); break;
            case 'done': cbs.onDone?.({ messageId: f.messageId, scenario: f.scenario, replyLength: f.replyLength }); break;
            case 'error': cbs.onError?.({ code: f.code, message: f.message }); break;
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;  // abort 属合法终止
      throw err;
    }
  })();

  return { abort: () => controller.abort(), done };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npm run test -- src/api/__tests__/chat-stream.test.ts
```

Expected: PASS，4 条用例全绿。

- [ ] **Step 5: Commit**

```bash
git add web/src/api/chat.ts web/src/api/__tests__/chat-stream.test.ts
git commit -m "feat(streaming): add streamChatMessage client with SSE parser"
```

---

## Task 11: `useConversation` hook 状态机

**Files:**
- Modify: `web/src/hooks/useConversation.ts`
- Create: `web/src/hooks/__tests__/useConversation.streaming.test.ts`

- [ ] **Step 1: 写失败测试覆盖状态机五种转移**

`web/src/hooks/__tests__/useConversation.streaming.test.ts`：

```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversation } from '@/hooks/useConversation';
import * as chatApi from '@/api/chat';

vi.mock('@/api/chat', async (orig) => {
  const m = await orig<typeof import('@/api/chat')>();
  return {
    ...m,
    fetchHistory: vi.fn().mockResolvedValue({ messages: [] }),
    streamChatMessage: vi.fn(),
    sendChatMessage: vi.fn(),
  };
});
const mockedStream = vi.mocked(chatApi.streamChatMessage);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(chatApi.fetchHistory).mockResolvedValue({ messages: [] });
  import.meta.env.VITE_STREAMING = 'true';
});

describe('useConversation — streaming state machine', () => {
  it('inserts user + empty assistant bubble on sendMessage and appends tokens', async () => {
    let cbs!: chatApi.StreamCallbacks;
    mockedStream.mockImplementation((_req, callbacks) => {
      cbs = callbacks;
      return { abort: vi.fn(), done: new Promise(() => {}) };
    });

    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => { result.current.sendMessage('hi'); });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: '' });
    expect(result.current.isStreaming).toBe(true);

    act(() => cbs.onMeta?.({ scenario: 'VOCABULARY' }));
    expect(result.current.messages[1].scenario).toBe('VOCABULARY');

    act(() => { cbs.onToken?.({ delta: 'He' }); cbs.onToken?.({ delta: 'llo' }); });
    expect(result.current.messages[1].content).toBe('Hello');
  });

  it('replaces temporary id with messageId on done and turns isStreaming off', async () => {
    let cbs!: chatApi.StreamCallbacks;
    mockedStream.mockImplementation((_r, c) => {
      cbs = c;
      return { abort: vi.fn(), done: Promise.resolve() };
    });
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => { result.current.sendMessage('hi'); });
    act(() => { cbs.onToken?.({ delta: 'Hi' }); cbs.onDone?.({ messageId: 'srv-1', scenario: 'VOCABULARY', replyLength: 2 }); });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1].id).toBe('srv-1');
  });

  it('removes streaming bubble (keeps user) and sets error on onError', async () => {
    let cbs!: chatApi.StreamCallbacks;
    mockedStream.mockImplementation((_r, c) => {
      cbs = c;
      return { abort: vi.fn(), done: Promise.resolve() };
    });
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => { result.current.sendMessage('hi'); });
    act(() => cbs.onError?.({ code: 'LLM_ERROR', message: 'oops' }));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.error).toBe('oops');
    expect(result.current.isStreaming).toBe(false);
  });

  it('removes both streaming bubble and user message on stop()', async () => {
    const abort = vi.fn();
    mockedStream.mockImplementation(() => ({ abort, done: new Promise(() => {}) }));
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => { result.current.sendMessage('hi'); });
    expect(result.current.messages).toHaveLength(2);

    act(() => { result.current.stop?.(); });
    expect(abort).toHaveBeenCalledOnce();
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
  });

  it('falls back to sendChatMessage when VITE_STREAMING=false', async () => {
    import.meta.env.VITE_STREAMING = 'false';
    vi.mocked(chatApi.sendChatMessage).mockResolvedValueOnce({ reply: 'hi', scenario: 'VOCABULARY' });
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => { await result.current.sendMessage('hi'); });
    expect(vi.mocked(chatApi.sendChatMessage)).toHaveBeenCalledOnce();
    expect(mockedStream).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npm run test -- src/hooks/__tests__/useConversation.streaming.test.ts
```

Expected: FAIL，`isStreaming` / `stop` 未导出；流式分支不存在。

- [ ] **Step 3: 改写 useConversation 加入状态机与 feature flag**

把现有 `useConversation` 改造为：

```ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, StreamCallbacks, StreamHandle } from '../types/chat';
import { sendChatMessage, streamChatMessage, fetchHistory, resetConversation as apiReset, ChatApiError } from '../api/chat';

/**
 * 读取 feature flag。必须在 hook 函数体内每次求值（而非模块顶层常量），
 * 否则 Vitest 测试在 beforeEach 中修改 `import.meta.env.VITE_STREAMING` 无法生效。
 */
function readUseStreamingFlag(): boolean {
  return import.meta.env.VITE_STREAMING !== 'false';
}

function newMessageId(): string { /* 保持现状 */ }

export interface UseConversationReturn {
  messages: Message[];
  isStreaming: boolean;          // 替代 isLoading
  /** 向后兼容：现有组件用 isLoading 字段，临时 re-export */
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
  resetConversation: () => Promise<void>;
  /** 仅在流式模式下存在；JSON 降级下为 undefined */
  stop?: () => void;
}

export function useConversation(): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<StreamHandle | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => { /* fetchHistory 与现状一致 */ }, []);

  const streamingSend = useCallback((trimmed: string) => {
    const userMsg: Message = { id: newMessageId(), role: 'user', content: trimmed, timestamp: Date.now() };
    const asstMsg: Message = { id: newMessageId(), role: 'assistant', content: '', timestamp: Date.now() };
    currentUserIdRef.current = userMsg.id;
    currentAssistantIdRef.current = asstMsg.id;
    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);
    setError(null);

    const cbs: StreamCallbacks = {
      onMeta: ({ scenario }) => {
        setMessages((prev) => prev.map((m) =>
          m.id === currentAssistantIdRef.current ? { ...m, scenario } : m));
      },
      onToken: ({ delta }) => {
        setMessages((prev) => prev.map((m) =>
          m.id === currentAssistantIdRef.current ? { ...m, content: m.content + delta } : m));
      },
      onDone: ({ messageId, scenario }) => {
        setMessages((prev) => prev.map((m) =>
          m.id === currentAssistantIdRef.current ? { ...m, id: messageId, scenario } : m));
        setIsStreaming(false);
        handleRef.current = null;
        currentAssistantIdRef.current = null;
        currentUserIdRef.current = null;
      },
      onError: ({ message }) => {
        setMessages((prev) => prev.filter((m) => m.id !== currentAssistantIdRef.current));
        setError(message);
        setIsStreaming(false);
        handleRef.current = null;
      },
    };

    const handle = streamChatMessage({ message: trimmed }, cbs);
    handleRef.current = handle;
    handle.done.catch((err) => {
      if (err instanceof ChatApiError) setError(err.message);
      else setError('网络连接失败，请检查网络后重试');
      setMessages((prev) => prev.filter((m) => m.id !== currentAssistantIdRef.current));
      setIsStreaming(false);
      handleRef.current = null;
    });
  }, []);

  // 与当前 `web/src/hooks/useConversation.ts` 中 line 49-85 的 sendMessage 主体等价，
  // 仅做两处微调：(1) 语义从 isLoading 改为 isStreaming；(2) 入参已为 trimmed，去掉二次 trim。
  const jsonSend = useCallback(async (trimmed: string) => {
    const userMessage: Message = {
      id: newMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
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
      setIsStreaming(false);
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    return readUseStreamingFlag() ? streamingSend(trimmed) : jsonSend(trimmed);
  }, [isStreaming, streamingSend, jsonSend]);

  const stop = useCallback(() => {
    handleRef.current?.abort();
    setMessages((prev) => prev.filter(
      (m) => m.id !== currentAssistantIdRef.current && m.id !== currentUserIdRef.current
    ));
    currentAssistantIdRef.current = null;
    currentUserIdRef.current = null;
    setIsStreaming(false);
    handleRef.current = null;
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const handleReset = useCallback(async () => { /* 现状不变 */ }, []);

  return {
    messages,
    isStreaming,
    isLoading: isStreaming,      // 向后兼容，下一任务移除
    error,
    sendMessage,
    clearError,
    resetConversation: handleReset,
    stop: readUseStreamingFlag() ? stop : undefined,
  };
}
```

- [ ] **Step 4: 确认既有 hook 测试（`useConversation.test.ts`）仍通过**

```bash
cd web && npm run test
```

Expected: 既有 8 条 + 新增 5 条全绿。若既有测试因 mock 不再 provide `sendChatMessage` 而断，就在既有测试里把 `import.meta.env.VITE_STREAMING` 显式设为 `'false'`。

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useConversation.ts web/src/hooks/__tests__/useConversation.streaming.test.ts
git commit -m "feat(streaming): wire streaming state machine + VITE_STREAMING flag into useConversation"
```

---

## Task 12: UI — 停止按钮 + 流式打字指示

**Files:**
- Modify: `web/src/components/ChatInput.tsx`
- Modify: `web/src/components/ChatWindow.tsx`
- Modify: `web/src/components/MessageList.tsx`

- [ ] **Step 1: ChatInput 支持 `onStop`，`isLoading` 时把"发送"切"停止"；不再禁用 textarea**

```tsx
interface ChatInputProps {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
}

/**
 * 关键 UX 调整（对齐 spec §6.4）：
 * - textarea 删除 `disabled={isLoading}`：流式中仍可输入下一条；
 * - 发送/停止按钮二选一渲染；
 * - `doSend` 在 `isStreaming` 时 **完全 no-op**：不调用 onSend、也不清空输入框
 *   （避免"按 Enter 清空但消息被 hook 拒绝"造成的内容丢失）。
 */

const doSend = () => {
  if (isStreaming) return;                // ← 优先于 onSend；不清空 input
  const trimmed = input.trim();
  if (!trimmed) return;
  onSend(trimmed);
  setInput('');
};

// textarea 的 disabled 删掉；按钮根据 isStreaming 切换：
{isStreaming && onStop ? (
  <Button type="button" size="sm" variant="destructive" onClick={onStop}>停止</Button>
) : (
  <Button type="submit" size="sm" disabled={!input.trim()}>发送</Button>
)}
```

- [ ] **Step 2: MessageList 在流式期间对"最后一条 assistant 消息"渲染打字光标**

去掉原来的"正在思考..."占位块；改为：当列表最后一条消息为 assistant 且 `isStreaming === true` 时，在其末尾追加一个呼吸的光标元素（例如 `<span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse align-middle ml-1" />`），由 MessageBubble 或 MessageList 渲染均可。

- [ ] **Step 3: ChatWindow 把 `stop` 透传给 ChatInput**

```tsx
interface ChatWindowProps { /* 加入 */ onStop?: () => void; isStreaming: boolean; ... }
<ChatInput isStreaming={isStreaming} onSend={onSend} onStop={onStop} />
```

调用处（`App.tsx` 或等效）：把 hook 的 `stop` 传进 `<ChatWindow onStop={stop} isStreaming={isStreaming} ...>`。

- [ ] **Step 4: 手动 smoke test（开发服务器）**

```bash
cd web && npm run dev
# 另开终端：npm run dev:server
```

在浏览器打开 Vite 服务页面：发送消息确认有打字机；点停止按钮确认本轮 user + assistant 气泡消失。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatInput.tsx web/src/components/ChatWindow.tsx web/src/components/MessageList.tsx
git commit -m "feat(streaming): show typing cursor and stop button during stream"
```

---

## Task 13: UI — Scenario 徽章 + transient 提示

**Files:**
- Modify: `web/src/components/MessageBubble.tsx`
- Modify: `web/src/components/ChatWindow.tsx`（或 `App.tsx`，看状态持有位置）

- [ ] **Step 1: MessageBubble 在 assistant 消息且 `message.scenario` 非空时显示徽章**

```tsx
{!isUser && message.scenario && (
  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
    {message.scenario}
  </div>
)}
```

- [ ] **Step 2: 中止后显示 "已停止" 2s**

在 App/ChatWindow 层用一个短暂 state：`stop()` 时 `setStopToast(true)`，2s 后 `setStopToast(false)`。渲染时在 error bar 之下加一条样式更柔和的条（非 destructive 色）。

```tsx
{stopToast && (
  <div className="flex shrink-0 items-center bg-muted px-4 py-2 text-sm text-muted-foreground">
    已停止
  </div>
)}
```

- [ ] **Step 3: 手动 smoke test**

发送消息并在首个 token 显示后点停止；确认徽章仅在收到 `meta` 后出现且消息被清理后 2s 看到"已停止"提示。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/MessageBubble.tsx web/src/components/ChatWindow.tsx web/src/App.tsx
git commit -m "feat(streaming): add scenario badge and transient stop toast"
```

---

## Task 14: 环境开关文档 + README 更新

**Files:**
- Create/Modify: `.env.example`（仓库根 + `web/`）
- Modify: `README.md`（若存在，否则跳过）

- [ ] **Step 1: 在 `web/.env.example` 中加入 `VITE_STREAMING`**

```
# 开启流式响应；设为 false 时前端走 JSON 降级（POST /api/chat）
VITE_STREAMING=true
```

- [ ] **Step 2: 在 README 中追加 Phase 4 条目（若项目已有 README）**

包括：新接口 `POST /api/chat/stream`、SSE 事件集、`VITE_STREAMING` 开关、验证脚本 `verify-streaming.ts`。

- [ ] **Step 3: Commit**

```bash
git add web/.env.example README.md
git commit -m "docs(streaming): document VITE_STREAMING flag and /chat/stream endpoint"
```

---

## Task 15: 最终验收与回归

**Files:** 无改动，仅验证。

- [ ] **Step 1: 全量测试**

```bash
npm run test
cd web && npm run test
cd .. && cd web && npm run build
```

Expected: 所有既有测试 + 新增测试全绿；前端构建成功。

- [ ] **Step 2: 手动验证场景（对照 spec §9 验收清单）**

- [ ] 发送消息 < 1s 内看到首 token
- [ ] Scenario 徽章严格早于首 token 出现（可看后端 `request.log` 和前端开发者工具 Network 中 SSE 帧顺序）
- [ ] 点停止：UI 两条消息消失 + `已停止` 2s 提示 + DB 无新行（`sqlite3 data/english-tutor.db "select count(*) from messages"` 前后对比）
- [ ] 刷新页面调 `/history`，中止的回合不出现；成功回合与以前一致
- [ ] 临时设 `VITE_STREAMING=false` 重建前端，确认行为完全等同当前 `main` 分支
- [ ] `npx tsx --env-file=.env src/graph/verify-streaming.ts` 仍能运行（烟雾测试）

- [ ] **Step 3: 如有手动验证发现问题，回到相关 Task 补测修复；否则收工**

---

## Skills Reference

- `superpowers:test-driven-development` — 每个 Task 的 Step 1/2/3/4 就是 TDD 循环
- `superpowers:verification-before-completion` — Task 15 的手动验收即其要求的"evidence before assertion"
- `superpowers:systematic-debugging` — 若 Task 1 spike 或后续集成遇到非预期行为，切换到该 skill 再定位
