import type { Scenario } from '@/classifier';

/** Phase 4 SSE 事件集合（详见 spec §4.3） */
export type StreamEvent =
  | { type: 'meta'; scenario: Scenario }
  | { type: 'token'; delta: string }
  | { type: 'done'; messageId: string; scenario: Scenario; replyLength: number }
  | { type: 'error'; code: string; message: string };

/**
 * 按严格 SSE 规范把 StreamEvent 序列化为一帧文本。
 * - 帧以 `\n\n` 结束
 * - `data:` 须单行；`JSON.stringify` 会把字面换行转成 `\n`，满足单行约束
 * - `type` 放在 `event:` 行，其余字段进入 `data` 的 JSON
 */
export function serializeSSE(event: StreamEvent): string {
  const { type, ...payload } = event;
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
