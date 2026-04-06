/**
 * Chat API 单元测试：通过 mock 全局 fetch，验证请求格式、成功解析与错误分支，
 * 不依赖真实网络或后端。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendChatMessage,
  checkHealth,
  fetchHistory,
  resetConversation,
  ChatApiError,
} from '@/api/chat';
import type { HistoryResponse } from '@/types/chat';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** 每例重置调用记录与返回值，避免串用例 */
beforeEach(() => {
  mockFetch.mockReset();
});

describe('sendChatMessage', () => {
  /** POST /api/chat、Content-Type 与 body 与 ChatRequest 一致 */
  it('sends request and returns response on success', async () => {
    const mockResponse = { reply: 'Hello!', scenario: 'greeting' };
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

  /** 4xx/5xx：解析 ErrorResponse JSON 并抛出，带上 code / statusCode */
  it('throws ChatApiError on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: 'Failed to process message',
          code: 'LLM_ERROR',
          statusCode: 500,
        }),
    });

    await expect(sendChatMessage({ message: 'Hi' })).rejects.toThrow(ChatApiError);

    try {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'Failed to process message',
            code: 'LLM_ERROR',
            statusCode: 500,
          }),
      });
      await sendChatMessage({ message: 'Hi' });
    } catch (err) {
      expect(err).toBeInstanceOf(ChatApiError);
      expect((err as ChatApiError).code).toBe('LLM_ERROR');
      expect((err as ChatApiError).statusCode).toBe(500);
    }
  });

  /** fetch 自身抛错（断网等）时 sendChatMessage 不包装，由上层 hook 决定用户可见文案 */
  it('rejects with TypeError when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(sendChatMessage({ message: 'Hi' })).rejects.toThrow(TypeError);
  });
});

describe('fetchHistory', () => {
  /** GET /api/history，成功时返回 HistoryResponse */
  it('returns messages on success', async () => {
    const payload: HistoryResponse = {
      messages: [{ id: '1', role: 'user', content: 'x', timestamp: 1 }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    const result = await fetchHistory();

    expect(mockFetch).toHaveBeenCalledWith('/api/history');
    expect(result).toEqual(payload);
  });

  /** 与 sendChatMessage 错误分支一致：解析 JSON 错误体 */
  it('throws ChatApiError on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({ error: 'Not found', code: 'NOT_FOUND', statusCode: 404 }),
    });

    await expect(fetchHistory()).rejects.toThrow(ChatApiError);
  });
});

describe('resetConversation', () => {
  /** POST /api/reset；成功时无 body 解析需求，仅校验 ok */
  it('posts to reset and resolves on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await resetConversation();

    expect(mockFetch).toHaveBeenCalledWith('/api/reset', { method: 'POST' });
  });

  /** 失败时同样走 ErrorResponse → ChatApiError */
  it('throws ChatApiError on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({ error: 'Bad', code: 'ERR', statusCode: 500 }),
    });

    await expect(resetConversation()).rejects.toThrow(ChatApiError);
  });
});

describe('checkHealth', () => {
  /** 监控/探活用，与其它 API 错误类型统一 */
  it('returns ok on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await checkHealth();
    expect(result).toEqual({ ok: true });
  });

  /** 非 2xx 且无标准 ErrorResponse 体时用 HEALTH_CHECK_FAILED */
  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(checkHealth()).rejects.toThrow(ChatApiError);
  });
});
