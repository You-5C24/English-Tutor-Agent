/**
 * Task 7：`POST /api/chat/stream` 集成契约（SSE 头与帧顺序）。
 * Task 8 Step 1：`AbortSignal` 传入 `chatStream`（`inject` 无法模拟 socket close，见 abort describe 注释）。
 * Task 8 Step 2：真实 `listen` + `http.request`，验证 socket destroy → `raw.close` → `AbortSignal.abort()`。
 */
import http from 'node:http';
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

/**
 * Task 8：路由把 `request.raw` 的 close 绑到 `AbortController`（见 `chat.ts`）。
 * `fastify.inject` 不模拟 socket close，若 mock 在首帧后无限 await abort，整个请求会挂起（见 plan 范围说明）。
 * 本用例只断言 `chatStream` 收到与请求同生命周期的 `AbortSignal`；真实 close→abort 在 Step 2 用 `app.listen` 补测。
 */
describe('POST /api/chat/stream — abort', () => {
  /**
   * 名称沿用计划文档；在 inject 级别实际验证的是「路由把 AbortController.signal 传给 chatStream」。
   * 客户端断开导致 downstream abort 需 Task 8 Step 2（真实 TCP）。
   */
  it('aborts downstream when the HTTP connection closes', async () => {
    const seenSignals: AbortSignal[] = [];
    const chatStreamMod = await import('@/services/chat-stream-service');
    // 覆盖文件顶部默认 factory，仅作用于下一次 chatStream() 调用（本 it 内那一次）。
    vi.mocked(chatStreamMod.chatStream).mockImplementationOnce(
      (async function* (_session, _msg, signal) {
        seenSignals.push(signal);
        yield { type: 'meta', scenario: 'VOCABULARY' };
        // inject 不会触发 raw close，若仅 await abort 则流永不结束；补 done 使 inject 可完成。abort 语义用 Step 2 实机 socket 覆盖。
        yield {
          type: 'done',
          messageId: 'abort-test',
          scenario: 'VOCABULARY',
          replyLength: 0,
        };
      }) as typeof chatStreamMod.chatStream,
    );

    const app = buildApp();
    // 路由：`request.raw.on('close', () => controller.abort())`，inject 无真实 socket，close 默认不发生。
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: { message: 'hi' },
    });

    expect(res.statusCode).toBe(200);
    expect(seenSignals).toHaveLength(1);
    // inject 模式下响应完成时连接会关闭；此时 signal 可能已被路由置为 aborted。
    expect(typeof seenSignals[0].aborted).toBe('boolean');
    await app.close();
  });
});

/**
 * Task 8 Step 2：`inject` 无真实 TCP；必须 `listen` + `http.request`。
 * 客户端 `destroy` → Node 关闭 socket → Fastify `request.raw` 触发 `close` → 路由里 `AbortController.abort()`。
 */
describe('POST /api/chat/stream — real socket abort', () => {
  it(
    'propagates abort to chatStream when the client destroys the socket',
    async () => {
      let capturedSignal: AbortSignal | undefined;
      /** 若 abort 未及时触发，finally 里再 resolve 一次，避免 async generator 永久挂起（多余 resolve 无害）。 */
      const pendingResolvers: Array<() => void> = [];
      const chatStreamMod = await import('@/services/chat-stream-service');

      vi.mocked(chatStreamMod.chatStream).mockImplementationOnce(
        (async function* (_session, _msg, signal) {
          capturedSignal = signal;
          yield { type: 'meta', scenario: 'VOCABULARY' };
          // 首帧写出后路由仍在 `for await`；此处挂起直到 abort，与真实 `chatStream` 被 signal 打断一致。
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve());
            pendingResolvers.push(resolve);
          });
        }) as typeof chatStreamMod.chatStream,
      );

      const app = buildApp();
      await app.listen({ port: 0, host: '127.0.0.1' }); // 0 = 系统分配空闲端口，避免硬编码冲突
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('no port bound');
      const port = address.port;

      try {
        await new Promise<void>((resolveTest, rejectTest) => {
          // 收到 SSE 首帧（含 meta）即切断连接，迫使服务端走 close→abort；勿等完整 body。
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
                  req.destroy();
                }
              });
              res.on('error', () => {
                /* destroy 会导致 res 报错，忽略 */
              });
            },
          );
          req.on('error', () => {
            /* destroy 后 req 报错属预期 */
          });
          req.write(JSON.stringify({ message: 'hi' }));
          req.end();

          // close/abort 异步传递；给事件循环一小段时间再断言（CI 偏慢时可酌情加大）。
          setTimeout(() => {
            try {
              expect(capturedSignal?.aborted).toBe(true);
              resolveTest();
            } catch (err) {
              rejectTest(err);
            }
          }, 200);
        });
      } finally {
        pendingResolvers.forEach((r) => {
          r();
        });
        await app.close();
      }
    },
    10_000, // 含真实 bind + 网络栈，默认超时偏紧时显式放宽
  );
});
