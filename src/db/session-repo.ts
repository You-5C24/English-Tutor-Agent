import { getDb } from './database.js';
import type { Session } from '@/types/session.js';

const DEFAULT_SESSION_ID = 'default';

interface SessionRow {
  id: string;
  summary: string;
  history: string;
  created_at: number;
  last_active_at: number;
}

/** 从 DB 加载唯一 session，不存在返回 null */
export function loadSession(): Session | null {
  const row = getDb()
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(DEFAULT_SESSION_ID) as SessionRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    summary: row.summary,
    history: JSON.parse(row.history),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

/** 保存 session（INSERT OR REPLACE，首次和更新通用） */
export function saveSession(session: Session): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO sessions (id, summary, history, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      DEFAULT_SESSION_ID,
      session.summary,
      JSON.stringify(session.history),
      session.createdAt,
      session.lastActiveAt
    );
}

/** 从 DB 删除 session */
export function resetSession(): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(DEFAULT_SESSION_ID);
}
