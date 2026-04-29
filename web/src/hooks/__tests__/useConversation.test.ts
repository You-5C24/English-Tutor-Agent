/**
 * useConversation 单元测试：
 * - 基础：消息发送与回复追加
 * - 持久化：挂载时加载历史消息
 * - 重置：resetConversation 清空消息
 * - 错误：API 失败与网络异常
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversation } from '@/hooks/useConversation';
import * as chatApi from '@/api/chat';

/** 保留真实 ChatApiError（hook 内 instanceof 需要），仅替换会发请求的函数 */
vi.mock('@/api/chat', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/chat')>();
  return {
    ...mod,
    sendChatMessage: vi.fn(),
    fetchHistory: vi.fn(),
    resetConversation: vi.fn(),
  };
});
const mockedSendChatMessage = vi.mocked(chatApi.sendChatMessage);
const mockedFetchHistory = vi.mocked(chatApi.fetchHistory);
const mockedResetConversation = vi.mocked(chatApi.resetConversation);

/** 默认空历史；crypto.randomUUID 按调用顺序固定返回值，便于断言消息 id */
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VITE_STREAMING', 'false'); // 本文件只测 JSON `sendChatMessage`，与流式专项测隔离
  mockedFetchHistory.mockResolvedValue({ messages: [] });
  vi.stubGlobal('crypto', {
    randomUUID: vi
      .fn()
      .mockReturnValueOnce('user-msg-1')
      .mockReturnValueOnce('assistant-msg-1')
      .mockReturnValueOnce('user-msg-2')
      .mockReturnValueOnce('assistant-msg-2'),
  });
});

describe('useConversation', () => {
  /** useEffect 应触发一次 fetchHistory；空历史时列表仍为空 */
  it('starts with empty state and loads history on mount', async () => {
    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalledOnce();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  /** 后端返回的 messages 应原样进入 state，供首屏还原 */
  it('populates messages from history API on mount', async () => {
    mockedFetchHistory.mockResolvedValueOnce({
      messages: [
        { id: 'h-1', role: 'user', content: 'hi', timestamp: 1000 },
        { id: 'h-2', role: 'assistant', content: 'hello', timestamp: 2000, scenario: 'greeting' },
      ],
    });

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages[0].content).toBe('hi');
    expect(result.current.messages[1].content).toBe('hello');
  });

  /** 持久化模型下请求体仅含 message，不再传 sessionId */
  it('sends a message and receives a reply (no sessionId)', async () => {
    mockedSendChatMessage.mockResolvedValueOnce({
      reply: 'Hello! How can I help?',
      scenario: 'greeting',
    });

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'Hi' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello! How can I help?' });

    expect(mockedSendChatMessage).toHaveBeenCalledWith({ message: 'Hi' });
  });

  /** ChatApiError：展示服务端 message，已发出的用户消息保留在列表 */
  it('sets error on API failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Server error', 'LLM_ERROR', 500)
    );

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
  });

  /** 非 ChatApiError（如 fetch TypeError）：统一网络友好文案 */
  it('sets network error message on fetch failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('网络连接失败，请检查网络后重试');
  });

  /** clearError 只清 error，不动 messages */
  it('clears error with clearError', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Error', 'LLM_ERROR', 500)
    );

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  /** 与发送逻辑一致：空白不上屏、不调 API */
  it('ignores empty or whitespace-only messages', async () => {
    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(mockedFetchHistory).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(result.current.messages).toEqual([]);
    expect(mockedSendChatMessage).not.toHaveBeenCalled();
  });

  /** 调用后端 reset 成功后本地列表应收空 */
  it('resetConversation clears messages and calls API', async () => {
    mockedFetchHistory.mockResolvedValueOnce({
      messages: [
        { id: 'h-1', role: 'user', content: 'hi', timestamp: 1000 },
      ],
    });
    mockedResetConversation.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useConversation());

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      await result.current.resetConversation();
    });

    expect(mockedResetConversation).toHaveBeenCalledOnce();
    expect(result.current.messages).toEqual([]);
  });
});
