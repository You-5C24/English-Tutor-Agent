import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 项目根目录：从 src/db/ 向上两级 */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

let db: DatabaseType | undefined;

/**
 * 初始化 SQLite 连接并建表
 * 传入 ':memory:' 可创建内存数据库（用于测试）
 */
export function initDb(dbPath?: string): void {
  if (db) return;

  const resolvedPath = dbPath ?? resolve(PROJECT_ROOT, DB_PATH);

  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      history TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      scenario TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
  `);
}

/** 获取已初始化的数据库连接 */
export function getDb(): DatabaseType {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/** 关闭数据库连接（服务器关闭或测试清理时调用） */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

/** 在单个 SQLite 事务中执行多个操作 */
export function runTransaction(fn: () => void): void {
  getDb().transaction(fn)();
}
