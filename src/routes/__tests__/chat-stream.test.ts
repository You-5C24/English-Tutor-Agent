/**
 * Task 7：`POST /api/chat/stream` 集成契约。
 * - Step 1：用 `fastify.inject` 断言 SSE 头、`event:` 行与顺序（meta → token → done），不跑真实图。
 * - 路由实现见 `src/routes/chat.ts`（Step 3）；Step 3 之前本文件预期 404（红阶段）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '@/app';
import * as sessionManager from '@/services/session-manager';
import { initTestDb, closeDb } from '@/db/__tests__/test-helpers';

/** `chat-service` → `@/rag/chroma-store` → `embedding` 会在 import 时要求 API key；路由测试只需桩掉 RAG。 */
vi.mock('@/rag/chroma-store', () => ({
  setChromaReadyState: vi.fn(),
  isChromaReady: vi.fn(() => false),
  initChromaRag: vi.fn(async () => false),
  retrieveFromChroma: vi.fn(async () => []),
}));

// 与真实 `chatStream` 解耦：只验证路由如何把 StreamEvent 写成 `serializeSSE` 字节流。
vi.mock('@/services/chat-stream-service', () => ({
  chatStream: vi.fn(async function* () {
    yield { type: 'meta', scenario: 'VOCABULARY' };
    yield { type: 'token', delta: 'Hello' };
    yield {
      type: 'done',
      messageId: 'abc',
      scenario: 'VOCABULARY',
      replyLength: 5,
    };
  }),
}));

beforeEach(() => {
  initTestDb(); // 路由若读库 / session 持久化，与线上一致使用内存库
  sessionManager.clearDefaultSession();
  sessionManager.initDefaultSession(); // `getDefaultSession()` 与 POST /chat 相同
});

afterEach(() => {
  closeDb();
});

describe('POST /api/chat/stream — happy path', () => {
  it('writes SSE frames with correct headers and ordering', async () => {
    // `app.register(chatRoutes, { prefix: '/api' })` → 全路径 `/api/chat/stream`
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

    // 与 streaming spec：首帧 meta，token 可多条，最后一帧为 done 或 error（此处仅 happy path）
    const iMeta = body.indexOf('event: meta');
    const iToken = body.indexOf('event: token');
    const iDone = body.indexOf('event: done');
    expect(iMeta).toBeGreaterThanOrEqual(0);
    expect(iMeta).toBeLessThan(iToken);
    expect(iToken).toBeLessThan(iDone);

    await app.close(); // inject 仍会持有插件资源，避免与其它用例串链
  });
});
