export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  scenario?: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: string;
  scenario: string;
}

export interface HistoryResponse {
  messages: Message[];
}

export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}

/** 与后端 SSE `serializeSSE` / `StreamEvent`（Phase 4）对齐 */
export type StreamEvent =
  | { type: 'meta'; scenario: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; messageId: string; scenario: string; replyLength: number }
  | { type: 'error'; code: string; message: string };

export interface StreamCallbacks {
  onMeta?: (evt: { scenario: string }) => void;
  onToken?: (evt: { delta: string }) => void;
  onDone?: (evt: { messageId: string; scenario: string; replyLength: number }) => void;
  onError?: (evt: { code: string; message: string }) => void;
}

export interface StreamHandle {
  abort: () => void;
  /**
   * 流生命周期结束时 resolve（包括 done / stream-level error via onError / user abort）。
   *
   * **仅在以下情况 reject**（"pre-stream 协议错"）：
   * - HTTP 非 200；
   * - 响应 Content-Type 不是 `text/event-stream`（spec §7 前端协议契约）；
   * - fetch 本身抛（网络断开、CORS 等），且 `abort()` 未主动触发。
   *
   * 流内语义错误（`event: error`）统一通过 `onError` 回调分派，**不**使 `done` reject。
   */
  done: Promise<void>;
}
