/**
 * Task 10 Step 1：`streamChatMessage` 契约（TDD 红阶段）。
 * 实现见 `web/src/api/chat.ts`（Step 3）；本文件用 mock `fetch` + 合成 SSE body。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamChatMessage, ChatApiError } from '@/api/chat';
import type { StreamCallbacks } from '@/types/chat';

/** 把多段 UTF-8 字符串喂进 `ReadableStream`，模拟 TCP 分包；帧格式与后端 `serializeSSE` 一致（`\n\n` 分帧）。 */
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

// 不发起真实 HTTP；各用例通过 `mockResolvedValueOnce` 注入 `Response`（含 body stream）。
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => mockFetch.mockReset());

describe('streamChatMessage', () => {
  /** 与 `POST /api/chat/stream` 成功路径一致：`event:` 行 + 单行 `data:` JSON。 */
  it('invokes callbacks in order for meta / token / done', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseResponse([
        'event: meta\ndata: {"scenario":"VOCABULARY"}\n\n',
        'event: token\ndata: {"delta":"Hel"}\n\n',
        'event: token\ndata: {"delta":"lo"}\n\n',
        'event: done\ndata: {"messageId":"m1","scenario":"VOCABULARY","replyLength":5}\n\n',
      ]),
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

  /** 解析器须在内部缓冲：首块可能只含 `event: tok`，拼上下一块才得到完整帧与合法 JSON。 */
  it('handles split frames across chunks', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseResponse([
        'event: tok',
        'en\ndata: {"delta',
        '":"ab"}\n\nevent: done\ndata: {"messageId":"m","scenario":"X","replyLength":2}\n\n',
      ]),
    );
    const tokens: string[] = [];
    const h = streamChatMessage({ message: 'hi' }, {
      onToken: (e: { delta: string }) => tokens.push(e.delta),
    });
    await h.done;
    expect(tokens).toEqual(['ab']);
  });

  /** 流前协议错：`!ok` 或非 `text/event-stream` → `done` reject；流内 `event: error` 走 `onError`（见 `StreamHandle` 注释）。 */
  it('throws ChatApiError for non-SSE error responses (pre-stream)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad', code: 'INVALID_REQUEST', statusCode: 400 }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const h = streamChatMessage({ message: '' }, {});
    await expect(h.done).rejects.toBeInstanceOf(ChatApiError);
  });

  /** `abort()` 后不得再处理后续 chunk；晚到 token 在 100ms 后才写出，10ms 即 abort 应被丢弃。 */
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
      new Response(slow, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const tokens: string[] = [];
    const h = streamChatMessage({ message: 'hi' }, {
      onToken: (e: { delta: string }) => tokens.push(e.delta),
    });
    setTimeout(() => h.abort(), 10);
    await h.done;
    expect(tokens).not.toContain('late');
  });
});
