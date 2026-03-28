/**
 * Chat API 单元测试：通过 mock 全局 fetch，验证请求格式、成功解析与错误分支，
 * 不依赖真实网络或后端。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendChatMessage, checkHealth, ChatApiError } from '@/api/chat';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  // 每个用例独立，避免 mock 调用次数/返回值串用例
  mockFetch.mockReset();
});

describe('sendChatMessage', () => {
  // 成功路径：POST /api/chat、JSON body、解析并返回 ChatResponse
  it('sends request and returns response on success', async () => {
    const mockResponse = { reply: 'Hello!', sessionId: 'sid-1', scenario: 'greeting' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await sendChatMessage({ message: 'Hi' });

    expect(mockFetch).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hi' }),
    });
    expect(result).toEqual(mockResponse);
  });

  // 传入 sessionId 时应序列化进请求体，供续会话
  it('includes sessionId in request when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ reply: 'Hi', sessionId: 'sid-1', scenario: 'grammar' }),
    });

    await sendChatMessage({ message: 'Hi', sessionId: 'sid-1' });

    expect(mockFetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      body: JSON.stringify({ message: 'Hi', sessionId: 'sid-1' }),
    }));
  });

  // 4xx/5xx：应抛 ChatApiError，并带上服务端返回的 code、statusCode
  it('throws ChatApiError on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Session not found', code: 'SESSION_NOT_FOUND', statusCode: 404 }),
    });

    await expect(sendChatMessage({ message: 'Hi', sessionId: 'bad-id' }))
      .rejects.toThrow(ChatApiError);

    try {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Session not found', code: 'SESSION_NOT_FOUND', statusCode: 404 }),
      });
      await sendChatMessage({ message: 'Hi', sessionId: 'bad-id' });
    } catch (err) {
      expect(err).toBeInstanceOf(ChatApiError);
      expect((err as ChatApiError).code).toBe('SESSION_NOT_FOUND');
      expect((err as ChatApiError).statusCode).toBe(404);
    }
  });

  // 网络层失败（如断网）：应原样抛出底层错误，不包装成 ChatApiError
  it('throws ChatApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(sendChatMessage({ message: 'Hi' })).rejects.toThrow(TypeError);
  });
});

describe('checkHealth', () => {
  // 健康检查成功：解析 JSON 并返回 { ok: true }
  it('returns ok on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await checkHealth();
    expect(result).toEqual({ ok: true });
  });

  // 健康检查非 2xx：应抛 ChatApiError（或统一 API 错误类型）
  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(checkHealth()).rejects.toThrow(ChatApiError);
  });
});
