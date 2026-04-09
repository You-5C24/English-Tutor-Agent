/**
 * 使用 SiliconFlow 生成向量并写入 Chroma；未安装 @chroma-core/default-embed 时，
 * SDK 可能在控制台打印 DefaultEmbeddingFunction 提示，可忽略（灌库与 query 仍走手动 embeddings）。
 */
import { ChromaClient, type Collection } from 'chromadb';
import { getEmbedding } from './embedding.js';
import { knowledgeBase } from './knowledge.js';

export interface ScoredEntry {
  text: string;
  score: number;
}

const COLLECTION_NAME = 'english-tutor-knowledge';

// initChromaRag() 成功后缓存，避免 retrieveFromChroma() 重复建连
let cachedCollection: Collection | null = null;

/** Chroma RAG 是否已初始化（undefined = 未尝试，true/false = 结果） */
let chromaReady: boolean | undefined;

/** 由 preload 在 initChromaRag settle 后写入，与知识库模块状态一致 */
export function setChromaReadyState(ok: boolean | undefined): void {
  chromaReady = ok;
}

/** 供图节点等查询 Chroma 是否已初始化就绪 */
export function isChromaReady(): boolean {
  return chromaReady === true;
}

/** 占位用的 embedding function，让 SDK 跳过 DefaultEmbeddingFunction 的初始化警告。
 *  实际向量始终由调用方手动传入（upsert/query 都带显式 embeddings），此函数不会被调用。
 */
const noopEmbeddingFunction = {
  generate: async (_texts: string[]): Promise<number[][]> => {
    throw new Error('[chroma-store] noopEmbeddingFunction should never be called');
  },
};

function parseChromaConnection(): { host: string; port: number; ssl: boolean } | null {
  const raw = process.env.CHROMA_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80;
    return {
      host: u.hostname,
      port,
      ssl: u.protocol === 'https:',
    };
  } catch {
    console.warn('  [Chroma] CHROMA_URL 无法解析，将忽略向量库:', raw);
    return null;
  }
}

function createClient(): ChromaClient {
  const conn = parseChromaConnection();
  if (!conn) {
    throw new Error('CHROMA_URL 未设置');
  }
  return new ChromaClient({
    host: conn.host,
    port: conn.port,
    ssl: conn.ssl,
  });
}

/**
 * 连接 Docker 中的 Chroma，创建集合并灌入知识库（与 SiliconFlow 向量维度一致）
 */
export async function initChromaRag(): Promise<boolean> {
  if (!parseChromaConnection()) return false;
  if (!process.env.SILICONFLOW_API_KEY) return false;

  const client = createClient();
  await client.heartbeat();

  let collection;
  try {
    collection = await client.getCollection({ name: COLLECTION_NAME, embeddingFunction: noopEmbeddingFunction });
  } catch {
    collection = await client.createCollection({
      name: COLLECTION_NAME,
      metadata: { 'hnsw:space': 'cosine' },
      embeddingFunction: noopEmbeddingFunction,
    });
  }

  cachedCollection = collection;
  const existing = await collection.count();
  if (existing >= knowledgeBase.length) {
    console.log(
      `  [Chroma] 集合 "${COLLECTION_NAME}" 已有 ${existing} 条，跳过灌库`
    );
    return true;
  }

  console.log(`  [Chroma] 正在向量化并写入 ${knowledgeBase.length} 条知识点...`);
  const embeddings: number[][] = [];
  for (const text of knowledgeBase) {
    embeddings.push(await getEmbedding(text));
  }

  const ids = knowledgeBase.map((_, i) => `kb-${i}`);
  await collection.upsert({
    ids,
    embeddings,
    documents: [...knowledgeBase],
  });
  console.log(`  [Chroma] 灌库完成（upsert ${knowledgeBase.length} 条）`);
  return true;
}

/**
 * 用户问题 → Embedding → Chroma 向量检索 Top-K
 * Chroma 在 cosine 空间下返回的 distance 通常可理解为 1 - cosine_similarity
 */
export async function retrieveFromChroma(
  userQuery: string,
  topK: number
): Promise<ScoredEntry[]> {
  const collection =
    cachedCollection ??
    (await createClient().getCollection({ name: COLLECTION_NAME, embeddingFunction: noopEmbeddingFunction }));

  const queryEmbedding = await getEmbedding(userQuery);
  const result = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    include: ['documents', 'distances'],
  });

  const docs = result.documents[0] ?? [];
  const dists = result.distances[0] ?? [];
  const out: ScoredEntry[] = [];

  for (let i = 0; i < docs.length; i++) {
    const text = docs[i];
    const d = dists[i];
    if (text == null) continue;
    const score =
      d != null && Number.isFinite(d) ? Math.max(0, 1 - d) : 0;
    out.push({ text, score });
  }

  return out;
}
