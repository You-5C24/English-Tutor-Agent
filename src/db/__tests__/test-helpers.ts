import { initDb, closeDb } from '@/db/database';

/**
 * 为 service 层测试准备一份干净的 in-memory DB；调用方应在 afterEach/afterAll 中 closeDb()。
 * 与 `src/db/__tests__/message-repo.test.ts` 的 initDb(':memory:') 语义完全一致，
 * 抽出成帮助函数只是为了复用。
 */
export function initTestDb(): void {
  closeDb(); // 若上一用例未关，先关；幂等
  initDb(':memory:');
}

export { closeDb };
