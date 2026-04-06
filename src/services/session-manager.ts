/**
 * 会话管理器 — 单用户持久化 Session 管理
 *
 * Phase 3 重构：从多 session 内存 Map 改为单 session + SQLite 持久化。
 * 启动时从 DB 加载唯一 session，运行时在内存中操作，chat 成功后写入 DB。
 */
import { Session } from '@/types/session';
import * as sessionRepo from '@/db/session-repo';

let defaultSession: Session | undefined;

/** 仅清空内存单例，不碰 DB。测试每个用例前应调用，避免 defaultSession 跨用例泄漏 */
export function clearDefaultSession(): void {
  defaultSession = undefined;
}

/** 从 DB 加载 session，若不存在则创建空 session 并写入 DB */
export function initDefaultSession(): void {
  const loaded = sessionRepo.loadSession();

  if (loaded) {
    defaultSession = loaded;
    console.log('  [Session] 已从数据库恢复会话');
  } else {
    const now = Date.now();
    defaultSession = {
      id: 'default',
      history: [],
      summary: '',
      createdAt: now,
      lastActiveAt: now,
    };
    sessionRepo.saveSession(defaultSession);
    console.log('  [Session] 已创建新会话');
  }
}

/** 获取内存中的唯一 session */
export function getDefaultSession(): Session {
  if (!defaultSession) {
    throw new Error(
      'Session not initialized. Call initDefaultSession() first.'
    );
  }
  return defaultSession;
}

/** 将当前 session 状态持久化到 DB */
export function save(): void {
  if (!defaultSession) return;
  defaultSession.lastActiveAt = Date.now();
  sessionRepo.saveSession(defaultSession);
}

/** 清空 session 记忆并持久化 */
export function reset(): void {
  const now = Date.now();
  defaultSession = {
    id: 'default',
    history: [],
    summary: '',
    createdAt: now,
    lastActiveAt: now,
  };
  sessionRepo.resetSession();
  sessionRepo.saveSession(defaultSession);
}
