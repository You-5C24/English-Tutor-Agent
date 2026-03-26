/**
 * 会话管理器 — 负责 Session 的创建、查找、续期和过期清理
 *
 * 这是整个 Web API 的状态管理核心。每个用户通过 sessionId 拥有独立的会话，
 * 对话历史和摘要都存在各自的 Session 对象里，互不干扰。
 *
 * 当前用内存 Map 存储，零外部依赖，个人项目完全够用。
 * TODO: 未来扩展小团队时，将内部存储从 Map 换成 Redis，接口不变，上下游无需改动。
 */
import { randomBytes } from 'node:crypto';
import { Session } from '../types/session.js';
import { SESSION_TTL, SESSION_CLEANUP_INTERVAL } from '../config.js';

/** 内存存储：sessionId → Session 对象 */
const sessions = new Map<string, Session>();
let cleanupTimer: NodeJS.Timeout | undefined;

/** 生成唯一 ID，前缀 s_ 方便在日志和调试中一眼识别这是 sessionId */
function generateId(): string {
  return 's_' + randomBytes(12).toString('hex');
}

/** 创建一个全新的空会话，自动存入 Map 并返回 */
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

/** 按 ID 查找会话，不存在返回 undefined（由路由层决定是 404 还是其他处理） */
export function get(id: string): Session | undefined {
  return sessions.get(id);
}

/**
 * 续期：更新会话的最后活跃时间。
 * 由路由层在 ChatService.chat() 成功后调用，
 * 这样 TTL 计时从"最后一次成功对话"算起，而非从创建时间算起。
 */
export function touch(session: Session): void {
  session.lastActiveAt = Date.now();
}

/** 扫描并删除所有超过 TTL 的过期会话，返回被清理的数量 */
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

/**
 * 启动定时清理器，每隔 SESSION_CLEANUP_INTERVAL 扫一次过期会话。
 * unref() 让这个定时器不阻止 Node.js 进程退出——
 * 如果没有其他活跃的事件（比如 HTTP server 已关闭），进程可以正常结束，不会被定时器卡住。
 */
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

/** 停止定时清理器，在服务器优雅关闭时调用 */
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
