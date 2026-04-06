import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '@/db/database';
import { addMessage, getRecentMessages, deleteAllMessages } from '@/db/message-repo';
import type { MessageRow } from '@/db/message-repo';

/** 每个用例独立内存库；关闭连接避免句柄泄漏 */
beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

describe('message-repo', () => {
  /** 无数据时与「空列表」语义一致，便于 UI 直接渲染 */
  it('returns empty array when no messages exist', () => {
    const messages = getRecentMessages();
    expect(messages).toEqual([]);
  });

  /** 单条写入后应能原样读出（含 scenario 可空） */
  it('adds and retrieves a message', () => {
    const msg: MessageRow = {
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      scenario: null,
      timestamp: 1000,
    };
    addMessage(msg);

    const messages = getRecentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  /** 对话展示需时间正序：先说的在前，后说的在后 */
  it('returns messages in chronological order (ASC)', () => {
    addMessage({ id: 'msg-1', role: 'user', content: 'first', scenario: null, timestamp: 1000 });
    addMessage({ id: 'msg-2', role: 'assistant', content: 'second', scenario: 'VOCABULARY', timestamp: 2000 });
    addMessage({ id: 'msg-3', role: 'user', content: 'third', scenario: null, timestamp: 3000 });

    const messages = getRecentMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[1].id).toBe('msg-2');
    expect(messages[2].id).toBe('msg-3');
  });

  /** 大量历史时只取最近 N 条，且返回顺序仍为正序（窗口内最旧→最新） */
  it('limits to most recent N messages', () => {
    for (let i = 1; i <= 5; i++) {
      addMessage({ id: `msg-${i}`, role: 'user', content: `msg ${i}`, scenario: null, timestamp: i * 1000 });
    }

    const messages = getRecentMessages(3);
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('msg-3');
    expect(messages[1].id).toBe('msg-4');
    expect(messages[2].id).toBe('msg-5');
  });

  /** 与会话一并清空消息，避免孤儿行 */
  it('deletes all messages', () => {
    addMessage({ id: 'msg-1', role: 'user', content: 'hello', scenario: null, timestamp: 1000 });
    addMessage({ id: 'msg-2', role: 'assistant', content: 'hi', scenario: 'VOCABULARY', timestamp: 2000 });

    deleteAllMessages();

    const messages = getRecentMessages();
    expect(messages).toEqual([]);
  });

  /** 幂等：空表调用也不应抛错，方便 reset 流程统一写 DELETE */
  it('deleteAll on empty table does not throw', () => {
    expect(() => deleteAllMessages()).not.toThrow();
  });
});
