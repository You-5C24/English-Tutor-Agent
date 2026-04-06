import type { ChatRequest, ChatResponse, HistoryResponse, ErrorResponse } from '../types/chat';

const API_BASE = '/api';

export class ChatApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'ChatApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function sendChatMessage(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }

  return res.json();
}

/** 加载最近的历史消息 */
export async function fetchHistory(): Promise<HistoryResponse> {
  const res = await fetch(`${API_BASE}/history`);

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }

  return res.json();
}

/** 重置对话，清空所有记忆 */
export async function resetConversation(): Promise<void> {
  const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }
}

export async function checkHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) {
    throw new ChatApiError('Health check failed', 'HEALTH_CHECK_FAILED', res.status);
  }
  return res.json();
}
