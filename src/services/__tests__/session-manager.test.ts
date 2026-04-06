import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '@/db/database';
import * as sessionRepo from '@/db/session-repo';
import {
  clearDefaultSession,
  initDefaultSession,
  getDefaultSession,
  save,
  reset,
} from '@/services/session-manager';

/** 先清内存单例再建库，避免模块级 defaultSession 跨用例残留 */
beforeEach(() => {
  clearDefaultSession();
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

describe('session-manager', () => {
  /** 冷启动：DB 无行时应在内存中构造 id=default 的空会话 */
  it('creates a new default session when DB is empty', () => {
    initDefaultSession();
    const session = getDefaultSession();

    expect(session.id).toBe('default');
    expect(session.history).toEqual([]);
    expect(session.summary).toBe('');
  });

  /** init 须落库，进程重启后才有可恢复的行 */
  it('writes new session to DB on init', () => {
    initDefaultSession();
    const fromDb = sessionRepo.loadSession();

    expect(fromDb).not.toBeNull();
    expect(fromDb!.id).toBe('default');
  });

  /** 启动前若 session-repo 已有数据，init 应还原到内存而非覆盖为空 */
  it('restores session from DB when data exists', () => {
    sessionRepo.saveSession({
      id: 'default',
      history: [{ role: 'user', content: 'hello' }],
      summary: 'previous summary',
      createdAt: 1000,
      lastActiveAt: 2000,
    });

    initDefaultSession();
    const session = getDefaultSession();

    expect(session.summary).toBe('previous summary');
    expect(session.history).toEqual([{ role: 'user', content: 'hello' }]);
    expect(session.createdAt).toBe(1000);
  });

  /** 防止未 init 就读内存引用导致静默 undefined */
  it('throws if getDefaultSession called before init', () => {
    expect(() => getDefaultSession()).toThrow('Session not initialized');
  });

  /** save 应把当前内存态写回 sessions 表（与直接改 repo 行为对齐） */
  it('save() persists session state to DB', () => {
    initDefaultSession();
    const session = getDefaultSession();

    session.history.push({ role: 'user', content: 'test' });
    session.summary = 'new summary';
    save();

    const fromDb = sessionRepo.loadSession();
    expect(fromDb!.summary).toBe('new summary');
    expect(fromDb!.history).toEqual([{ role: 'user', content: 'test' }]);
  });

  /** reset：内存回到空会话，且 DB 中仍为一条「空」default 行（非 delete） */
  it('reset() clears session and DB', () => {
    initDefaultSession();
    const session = getDefaultSession();
    session.history.push({ role: 'user', content: 'test' });
    session.summary = 'some summary';
    save();

    reset();

    const resetted = getDefaultSession();
    expect(resetted.history).toEqual([]);
    expect(resetted.summary).toBe('');

    const fromDb = sessionRepo.loadSession();
    expect(fromDb).not.toBeNull();
    expect(fromDb!.history).toEqual([]);
    expect(fromDb!.summary).toBe('');
  });
});
