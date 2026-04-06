import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '@/db/database';
import { loadSession, saveSession, resetSession } from '@/db/session-repo';
import type { Session } from '@/types/session';

/** 每个用例独立内存库，互不污染；结束后关闭连接避免泄漏 */
beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

describe('session-repo', () => {
  /** 空库时不应伪造 session，调用方据此判断「尚无持久化状态」 */
  it('returns null when no session exists', () => {
    const session = loadSession();
    expect(session).toBeNull();
  });

  /** 校验 JSON 序列化往返：history 与标量字段与写入前一致 */
  it('saves and loads a session with data integrity', () => {
    const session: Session = {
      id: 'default',
      history: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
      summary: 'User said hello',
      createdAt: 1000,
      lastActiveAt: 2000,
    };

    saveSession(session);
    const loaded = loadSession();

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('default');
    expect(loaded!.summary).toBe('User said hello');
    expect(loaded!.history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(loaded!.createdAt).toBe(1000);
    expect(loaded!.lastActiveAt).toBe(2000);
  });

  /** 同一逻辑 id 再次 save 须更新行而非重复插入（INSERT OR REPLACE 语义） */
  it('overwrites existing session on save (upsert)', () => {
    const session: Session = {
      id: 'default',
      history: [],
      summary: 'old',
      createdAt: 1000,
      lastActiveAt: 1000,
    };
    saveSession(session);

    session.summary = 'updated';
    session.lastActiveAt = 3000;
    saveSession(session);

    const loaded = loadSession();
    expect(loaded!.summary).toBe('updated');
    expect(loaded!.lastActiveAt).toBe(3000);
  });

  /** reset 后应回到「无 session」状态，与首测 loadSession 行为一致 */
  it('resets session by deleting from DB', () => {
    const session: Session = {
      id: 'default',
      history: [{ role: 'user', content: 'test' }],
      summary: 'some summary',
      createdAt: 1000,
      lastActiveAt: 2000,
    };
    saveSession(session);
    expect(loadSession()).not.toBeNull();

    resetSession();
    expect(loadSession()).toBeNull();
  });
});
