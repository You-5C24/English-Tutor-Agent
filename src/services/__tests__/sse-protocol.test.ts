/**
 * Task 2 Step 1：serializeSSE / StreamEvent 的契约测试（TDD 红阶段）。
 * 实现见 `src/services/sse-protocol.ts`（Step 3）；本文件先行锁定帧格式与 JSON 转义行为。
 */
import { describe, it, expect } from 'vitest';
import { serializeSSE, type StreamEvent } from '@/services/sse-protocol';

describe('serializeSSE', () => {
  /** 首帧 meta：event 行用类型名，data 为不含 type 的 JSON（仅 scenario），帧以空行结束 */
  it('encodes meta event with scenario', () => {
    const evt: StreamEvent = { type: 'meta', scenario: 'VOCABULARY' };
    expect(serializeSSE(evt)).toBe(
      'event: meta\ndata: {"scenario":"VOCABULARY"}\n\n'
    );
  });

  /** 流式增量：token 帧只携带 delta，便于前端拼接 assistant 文本 */
  it('encodes token event with delta', () => {
    const evt: StreamEvent = { type: 'token', delta: 'Hello' };
    expect(serializeSSE(evt)).toBe('event: token\ndata: {"delta":"Hello"}\n\n');
  });

  /**
   * delta 内真实换行须进 JSON 转义，保证每条 `data:` 物理上只占一行；
   * 且整帧只能有一个 `\n\n` 结束符，避免被误判为多帧。
   */
  it('escapes newlines inside delta to satisfy single-line JSON', () => {
    const evt: StreamEvent = { type: 'token', delta: 'line1\nline2' };
    const out = serializeSSE(evt);
    expect(out).toBe('event: token\ndata: {"delta":"line1\\nline2"}\n\n');
    expect(out.split('\n\n')).toHaveLength(2);
  });

  /** 正常收尾：持久化后的 messageId + 分类 + 回复长度，供前端对齐 DB 与 UI */
  it('encodes done event with messageId / scenario / replyLength', () => {
    const evt: StreamEvent = {
      type: 'done',
      messageId: 'm1',
      scenario: 'GRAMMAR_CORRECTION',
      replyLength: 42,
    };
    expect(serializeSSE(evt)).toBe(
      'event: done\ndata: {"messageId":"m1","scenario":"GRAMMAR_CORRECTION","replyLength":42}\n\n'
    );
  });

  /** 可恢复错误：机器可读 code + 人类可读 message，与 HTTP 层错误分流 */
  it('encodes error event with code / message', () => {
    const evt: StreamEvent = { type: 'error', code: 'LLM_ERROR', message: 'oops' };
    expect(serializeSSE(evt)).toBe(
      'event: error\ndata: {"code":"LLM_ERROR","message":"oops"}\n\n'
    );
  });
});
