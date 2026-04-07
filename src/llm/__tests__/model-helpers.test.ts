/**
 * Task 0.3 Step 1：OpenAI ChatCompletionMessageParam ↔ LangChain BaseMessage 转换的契约测试。
 * 实现见 `model-helpers.ts`（TDD：先红后绿）。
 */
import { describe, it, expect } from 'vitest';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { toBaseMessages, fromAIMessage } from '@/llm/model-helpers';

describe('toBaseMessages', () => {
  /** user 角色应对应 HumanMessage，供 LangChain 链消费 */
  it('converts user message', () => {
    const result = toBaseMessages([{ role: 'user', content: 'hello' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(HumanMessage);
    expect(result[0].content).toBe('hello');
  });

  /** assistant 角色应对应 AIMessage */
  it('converts assistant message', () => {
    const result = toBaseMessages([{ role: 'assistant', content: 'hi' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(AIMessage);
    expect(result[0].content).toBe('hi');
  });

  /** system 提示词单独成 SystemMessage */
  it('converts system message', () => {
    const result = toBaseMessages([
      { role: 'system', content: 'you are a tutor' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(SystemMessage);
  });

  /** 多轮对话顺序必须保留，否则上下文错乱 */
  it('converts mixed array preserving order', () => {
    const input: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const result = toBaseMessages(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeInstanceOf(SystemMessage);
    expect(result[1]).toBeInstanceOf(HumanMessage);
    expect(result[2]).toBeInstanceOf(AIMessage);
  });
});

describe('fromAIMessage', () => {
  /** 从 AIMessage 抽出纯文本，供落库或 OpenAI 格式回写 */
  it('extracts text content from AIMessage', () => {
    const msg = new AIMessage({ content: 'hello world' });
    expect(fromAIMessage(msg)).toBe('hello world');
  });

  it('returns empty string for empty content', () => {
    const msg = new AIMessage({ content: '' });
    expect(fromAIMessage(msg)).toBe('');
  });
});
