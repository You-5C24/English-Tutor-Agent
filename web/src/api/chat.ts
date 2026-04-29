import type {
  ChatRequest,
  ChatResponse,
  HistoryResponse,
  ErrorResponse,
  StreamCallbacks,
  StreamEvent,
  StreamHandle,
} from '../types/chat';

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

/** 加载最近的历史消息；可传 `signal` 与 React effect cleanup 配合取消请求 */
export async function fetchHistory(options?: { signal?: AbortSignal }): Promise<HistoryResponse> {
  const res = await fetch(`${API_BASE}/history`, { signal: options?.signal });

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

/**
 * 最小 SSE 解析，与后端 `serializeSSE` 输出对齐。
 * - 以 `\n\n` 为帧界；`rest` 保留未凑满一帧的尾部，供与下一 chunk 拼接（应对 TCP 分包）。
 * - 忽略 `:` 开头的注释/心跳行；多条 `data:` 行按规范拼接后再 `JSON.parse`。
 */
function parseSseBuffer(buf: string): { frames: StreamEvent[]; rest: string } {
  const frames: StreamEvent[] = [];
  let rest = buf;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let eventName: string | undefined;
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // SSE comment / heartbeat
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!eventName) continue;
    try {
      const payload = JSON.parse(data || '{}') as Record<string, unknown>;
      frames.push({ type: eventName, ...payload } as StreamEvent);
    } catch {
      /* 恶意/损坏帧忽略 */
    }
  }
  return { frames, rest };
}

/**
 * 调用 `POST /api/chat/stream`，消费 SSE 并回调 `StreamCallbacks`。
 * `abort()` 与路由侧 `AbortSignal` 一致，用于离开页面或用户取消；`done` 语义见 `StreamHandle`。
 */
export function streamChatMessage(req: { message: string }, cbs: StreamCallbacks): StreamHandle {
  const controller = new AbortController();

  const done = (async () => {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal, // 与后端 `request.raw` close 联动，见路由 streaming 实现
    });

    // 流前契约：非 200 或非 SSE 一律按 JSON 错误体处理（与 spec 前端协议一致）
    const ct = res.headers.get('Content-Type') ?? '';
    if (!res.ok || !ct.includes('text/event-stream')) {
      const err = (await res.json().catch(() => null)) as ErrorResponse | null;
      throw new ChatApiError(
        err?.error ?? `HTTP ${res.status}`,
        err?.code ?? 'UNEXPECTED_RESPONSE',
        err?.statusCode ?? res.status,
      );
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true }); // `stream: true` 保留 UTF-8 多字节边界上的半字符
        const { frames, rest } = parseSseBuffer(buf);
        buf = rest;
        for (const f of frames) {
          if (controller.signal.aborted) return; // 用户 abort 后不再派发，避免与 UI 卸载竞态
          switch (f.type) {
            case 'meta':
              cbs.onMeta?.({ scenario: f.scenario });
              break;
            case 'token':
              cbs.onToken?.({ delta: f.delta });
              break;
            case 'done':
              cbs.onDone?.({
                messageId: f.messageId,
                scenario: f.scenario,
                replyLength: f.replyLength,
              });
              break;
            case 'error':
              cbs.onError?.({ code: f.code, message: f.message });
              break;
            default:
              // 未知 `event:` 名：忽略，保持解析器向前兼容
              break;
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return; // fetch/read 因 abort 抛错时视为正常结束
      throw err;
    }
  })();

  return {
    abort: () => controller.abort(),
    done,
  };
}
