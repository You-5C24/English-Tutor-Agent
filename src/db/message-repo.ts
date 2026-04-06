import { getDb } from './database';
import { DISPLAY_MESSAGE_LIMIT } from '@/config';

export interface MessageRow {
  id: string;
  role: string;
  content: string;
  scenario: string | null;
  timestamp: number;
}

/** 追加一条消息到 messages 表 */
export function addMessage(msg: MessageRow): void {
  getDb()
    .prepare(
      'INSERT INTO messages (id, role, content, scenario, timestamp) VALUES (?, ?, ?, ?, ?)'
    )
    .run(msg.id, msg.role, msg.content, msg.scenario, msg.timestamp);
}

/**
 * 获取最近 N 条消息，按时间正序返回（上旧下新）。
 * SQL：子查询 DESC LIMIT N 取最近 N 条，外层 ASC 排序。
 */
export function getRecentMessages(
  limit: number = DISPLAY_MESSAGE_LIMIT
): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?
       ) ORDER BY timestamp ASC`
    )
    .all(limit) as MessageRow[];
}

/** 清空全部消息 */
export function deleteAllMessages(): void {
  getDb().prepare('DELETE FROM messages').run();
}
