/**
 * Task 11：`useConversation` 流式状态机契约。
 * 实现见 `web/src/hooks/useConversation.ts`（Step 3）；`VITE_STREAMING` 用 `vi.stubEnv` 切换。
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversation } from '@/hooks/useConversation';
import * as chatApi from '@/api/chat';
import type { StreamCallbacks } from '@/types/chat';

// 保留 `ChatApiError` 等真实导出；网络入口全部可桩，便于断言回调与分支。
vi.mock('@/api/chat', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/chat')>();
  return {
    ...mod,
    fetchHistory: vi.fn().mockResolvedValue({ messages: [] }),
    streamChatMessage: vi.fn(),
    sendChatMessage: vi.fn(),
  };
});
const mockedStream = vi.mocked(chatApi.streamChatMessage);

/** `import.meta.env` 在类型上为 readonly；测试中需可写以切换 feature flag */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(chatApi.fetchHistory).mockResolvedValue({ messages: [] });
  // 直接改 `import.meta.env` 在 Vitest 里不可靠；用 stubEnv 与 Vite 行为一致
  vi.stubEnv('VITE_STREAMING', 'true');
});

describe('useConversation — streaming state machine', () => {
  /** 发送 → 双气泡占位 + `isStreaming`；`done` 永不 resolve 模拟长连接，便于只测中途回调 */
  it('inserts user + empty assistant bubble on sendMessage and appends tokens', async () => {
    let cbs!: StreamCallbacks;
    mockedStream.mockImplementation((_req, callbacks) => {
      cbs = callbacks;
      return { abort: vi.fn(), done: new Promise(() => {}) };
    });

    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => {
      result.current.sendMessage('hi');
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: '' });
    expect(result.current.isStreaming).toBe(true);

    act(() => cbs.onMeta?.({ scenario: 'VOCABULARY' }));
    expect(result.current.messages[1].scenario).toBe('VOCABULARY');

    act(() => {
      cbs.onToken?.({ delta: 'He' });
      cbs.onToken?.({ delta: 'llo' });
    });
    expect(result.current.messages[1].content).toBe('Hello');
  });

  /** `onDone` 将占位 assistant 的 id 换为服务端 `messageId`，并结束流式态 */
  it('replaces temporary id with messageId on done and turns isStreaming off', async () => {
    let cbs!: StreamCallbacks;
    mockedStream.mockImplementation((_r, c) => {
      cbs = c;
      return { abort: vi.fn(), done: Promise.resolve() };
    });
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => {
      result.current.sendMessage('hi');
    });
    act(() => {
      cbs.onToken?.({ delta: 'Hi' });
      cbs.onDone?.({ messageId: 'srv-1', scenario: 'VOCABULARY', replyLength: 2 });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1].id).toBe('srv-1');
  });

  /** 流内 `event:error`：去掉 assistant 气泡，保留用户句，暴露 `error` 文案 */
  it('removes streaming bubble (keeps user) and sets error on onError', async () => {
    let cbs!: StreamCallbacks;
    mockedStream.mockImplementation((_r, c) => {
      cbs = c;
      return { abort: vi.fn(), done: Promise.resolve() };
    });
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => {
      result.current.sendMessage('hi');
    });
    act(() => cbs.onError?.({ code: 'LLM_ERROR', message: 'oops' }));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.error).toBe('oops');
    expect(result.current.isStreaming).toBe(false);
  });

  /** 用户主动 `stop`：abort 下游请求，并撤销本轮 user+assistant（与「仅 onError 删 assistant」区分） */
  it('removes both streaming bubble and user message on stop()', async () => {
    const abort = vi.fn();
    mockedStream.mockImplementation(() => ({ abort, done: new Promise(() => {}) }));
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => {
      result.current.sendMessage('hi');
    });
    expect(result.current.messages).toHaveLength(2);

    act(() => {
      result.current.stop?.();
    });
    expect(abort).toHaveBeenCalledOnce();
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
  });

  /** Feature flag 关闭时与 Phase 3 行为一致：仅 JSON `POST /chat`，不调 `streamChatMessage` */
  it('falls back to sendChatMessage when VITE_STREAMING=false', async () => {
    vi.stubEnv('VITE_STREAMING', 'false');
    vi.mocked(chatApi.sendChatMessage).mockResolvedValueOnce({ reply: 'hi', scenario: 'VOCABULARY' });
    const { result } = renderHook(() => useConversation());
    await waitFor(() => expect(vi.mocked(chatApi.fetchHistory)).toHaveBeenCalled());

    await act(async () => {
      await result.current.sendMessage('hi');
    });
    expect(vi.mocked(chatApi.sendChatMessage)).toHaveBeenCalledOnce();
    expect(mockedStream).not.toHaveBeenCalled();
  });
});
