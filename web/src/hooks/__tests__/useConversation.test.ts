/**
 * useConversation 单元测试：mock chat API，验证消息列表、会话 id 传递、
 * 各类错误文案与 clearError，不发起真实 HTTP。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversation } from '@/hooks/useConversation';
import * as chatApi from '@/api/chat';

// 只替换 sendChatMessage，保留真实 ChatApiError，否则 hook 内 instanceof 不成立
vi.mock('@/api/chat', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/chat')>();
  return {
    ...mod,
    sendChatMessage: vi.fn(),
  };
});
const mockedSendChatMessage = vi.mocked(chatApi.sendChatMessage);

beforeEach(() => {
  vi.resetAllMocks();
  // 为每条用户/助手消息提供稳定 id，便于断言顺序与条数
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
  // 初始：无消息、非加载、无错误
  it('starts with empty state', () => {
    const { result } = renderHook(() => useConversation());

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // 成功路径：追加用户消息与助手回复，并带上 scenario
  it('sends a message and receives a reply', async () => {
    mockedSendChatMessage.mockResolvedValueOnce({
      reply: 'Hello! How can I help?',
      sessionId: 'sid-1',
      scenario: 'greeting',
    });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'Hi',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello! How can I help?',
      scenario: 'greeting',
    });
    expect(result.current.isLoading).toBe(false);
  });

  // 首轮不传 sessionId，后续请求应带上服务端返回的 sessionId
  it('passes sessionId on subsequent messages', async () => {
    mockedSendChatMessage
      .mockResolvedValueOnce({
        reply: 'Hi',
        sessionId: 'sid-1',
        scenario: 'greeting',
      })
      .mockResolvedValueOnce({
        reply: 'Sure',
        sessionId: 'sid-1',
        scenario: 'grammar',
      });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hello');
    });
    expect(mockedSendChatMessage).toHaveBeenCalledWith({
      message: 'Hello',
      sessionId: undefined,
    });

    await act(async () => {
      await result.current.sendMessage('Teach me grammar');
    });
    expect(mockedSendChatMessage).toHaveBeenCalledWith({
      message: 'Teach me grammar',
      sessionId: 'sid-1',
    });
  });

  // ChatApiError：展示服务端 message，保留已发出的用户消息
  it('sets error on API failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Server error', 'LLM_ERROR', 500)
    );

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.messages).toHaveLength(1); // user message preserved
    expect(result.current.isLoading).toBe(false);
  });

  // 非 ChatApiError（如网络 TypeError）：统一友好文案
  it('sets network error message on fetch failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('网络连接失败，请检查网络后重试');
  });

  // clearError 清空 error，不影响 messages
  it('clears error with clearError', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Error', 'LLM_ERROR', 500)
    );

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  // 空串或纯空白：不调用 API、不产生消息
  it('ignores empty or whitespace-only messages', async () => {
    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(result.current.messages).toEqual([]);
    expect(mockedSendChatMessage).not.toHaveBeenCalled();
  });

  // 会话失效：提示用户重新开始，并清除本地 sessionId，便于下一轮当作新会话
  it('resets sessionId on SESSION_NOT_FOUND error', async () => {
    mockedSendChatMessage
      .mockResolvedValueOnce({
        reply: 'Hi',
        sessionId: 'sid-1',
        scenario: 'greeting',
      })
      .mockRejectedValueOnce(
        new chatApi.ChatApiError('Session not found', 'SESSION_NOT_FOUND', 404)
      );

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    await act(async () => {
      await result.current.sendMessage('Again');
    });

    expect(result.current.error).toBe('会话已过期，请重新发送消息开始新对话');
  });
});
