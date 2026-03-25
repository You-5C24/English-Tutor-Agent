import OpenAI from 'openai';

/** Embedding 专用客户端，指向 SiliconFlow */
const embeddingClient = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: 'https://api.siliconflow.cn/v1',
});

/**
 * 调用 SiliconFlow Embedding API，将一段文字转成 1024 维向量
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await embeddingClient.embeddings.create({
    model: 'BAAI/bge-large-zh-v1.5',
    input: text,
  });

  return response.data[0].embedding;
}
