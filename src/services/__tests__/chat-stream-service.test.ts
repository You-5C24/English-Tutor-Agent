/**
 * Task 3 Step 1：`chatStream` happy path 契约（TDD 红阶段）。
 * 实现见 `src/services/chat-stream-service.ts`（Step 3）；此处锁定事件序列与 DB 落库语义。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StreamEvent } from '@/services/sse-protocol';

/**
 * 可变的伪 LangGraph 事件队列；由 `vi.mock('@/graph/index')` 中的 async generator 消费。
 * 必须用 vi.hoisted：mock 工厂会被 Vitest 提升到文件顶，若这里用普通模块级 let，
 * 工厂执行时仍处于 TDZ → ReferenceError。
 */
const { fakeEvents } = vi.hoisted(() => ({ fakeEvents: [] as unknown[] }));

vi.mock('@/graph/index', () => ({
  tutorGraph: {
    /** 与真实 `streamEvents` 签名对齐；yield 前检查 abort 以模拟 LangGraph 行为 */
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
  initTestDb(); // close + 新内存库，避免与上一用例共用连接
  sessionManager.clearDefaultSession();
  sessionManager.initDefaultSession(); // 写入当前 DB 的 default session
});

afterEach(() => {
  closeDb();
});

/** 消费 async iterable，便于对完整 StreamEvent 序列做断言 */
async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const evt of iter) out.push(evt);
  return out;
}

describe('chatStream — happy path', () => {
  /**
   * 事件顺序与 Task 1 notes 对齐：先 classify（meta），再 token 流，再 compress / respond（终态字段）。
   * 故意不伪造 root `LangGraph` 的 on_chain_end：当前实现约定只从节点级事件收集（见 plan Task 3 Step 1）。
   */
  it('emits meta → tokens → done and persists user + assistant rows', async () => {
    fakeEvents.push(
      { event: 'on_chain_end', name: 'classify', data: { output: { scenario: 'VOCABULARY' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'Hel' } } },
      { event: 'on_chat_model_stream', data: { chunk: { content: 'lo' } } },
      {
        event: 'on_chain_end',
        name: 'compress',
        data: { output: { compressedHistory: [], compressedSummary: '' } },
      },
      { event: 'on_chain_end', name: 'respond', data: { output: { reply: 'Hello' } } },
    );

    const session = sessionManager.getDefaultSession();
    const controller = new AbortController();
    const events = await collect(chatStream(session, 'hi', controller.signal));

    expect(events[0]).toEqual({ type: 'meta', scenario: 'VOCABULARY' });
    expect(events.filter((e) => e.type === 'token').map((e) => (e as { delta: string }).delta)).toEqual([
      'Hel',
      'lo',
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', scenario: 'VOCABULARY', replyLength: 5 });
    expect((done as { messageId: string }).messageId).toMatch(/.+/);

    const rows = messageRepo.getRecentMessages();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(rows[1]).toMatchObject({ role: 'assistant', content: 'Hello', scenario: 'VOCABULARY' });
  });
});
