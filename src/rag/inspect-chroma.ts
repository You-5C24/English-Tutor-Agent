/**
 * 查看 Chroma 知识库内容
 * 用法：npx tsx --env-file=.env src/rag/inspect-chroma.ts
 */
import { ChromaClient } from 'chromadb';

const COLLECTION_NAME = 'english-tutor-knowledge';

async function main() {
  const url = process.env.CHROMA_URL ?? 'http://localhost:8000';
  const u = new URL(url);
  const client = new ChromaClient({
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 8000,
    ssl: u.protocol === 'https:',
  });

  await client.heartbeat();
  console.log(`✅ Chroma 连接正常: ${url}\n`);

  let collection;
  try {
    collection = await client.getCollection({ name: COLLECTION_NAME });
  } catch {
    console.log(`❌ 集合 "${COLLECTION_NAME}" 不存在，请先运行灌库脚本`);
    return;
  }

  const total = await collection.count();
  console.log(`📚 集合: ${COLLECTION_NAME}`);
  console.log(`📊 总条数: ${total} 条\n`);

  if (total === 0) {
    console.log('集合为空，尚未灌库');
    return;
  }

  // 拉取所有记录（原文 + id），不拉向量（太长没意义）
  const result = await collection.get({ include: ['documents', 'metadatas'] });

  console.log('─'.repeat(60));
  result.ids.forEach((id, i) => {
    const doc = result.documents[i] ?? '(无原文)';
    console.log(`[${id}] ${doc}`);
    console.log('─'.repeat(60));
  });
}

main().catch(console.error);
