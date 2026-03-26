import { randomBytes } from 'node:crypto';
import { Session } from '../types/session.js';
import { SESSION_TTL, SESSION_CLEANUP_INTERVAL } from '../config.js';

const sessions = new Map<string, Session>();
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

function generateId(): string {
  return 's_' + randomBytes(12).toString('hex');
}

export function create(): Session {
  const now = Date.now();
  const session: Session = {
    id: generateId(),
    history: [],
    summary: '',
    createdAt: now,
    lastActiveAt: now,
  };
  sessions.set(session.id, session);
  return session;
}

export function get(id: string): Session | undefined {
  return sessions.get(id);
}

export function touch(session: Session): void {
  session.lastActiveAt = Date.now();
}

export function cleanup(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > SESSION_TTL) {
      sessions.delete(id);
      removed++;
    }
  }
  return removed;
}

export function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const removed = cleanup();
    if (removed > 0) {
      console.log(`  [Session] 清理了 ${removed} 个过期会话，剩余 ${sessions.size} 个`);
    }
  }, SESSION_CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/** 当前活跃会话数（调试用） */
export function size(): number {
  return sessions.size;
}
