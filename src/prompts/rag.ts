import type { ScoredEntry } from '../rag/chroma-store.js';

/**
 * 将检索到的知识点格式化为 system 可读的上下文块
 */
export function formatRagContext(items: ScoredEntry[]): string {
  if (items.length === 0) return '';

  const blocks = items.map(
    (item, i) =>
      `[${i + 1}] (similarity ${item.score.toFixed(3)})\n${item.text}`
  );

  return `
<retrieved_knowledge>
The following snippets were retrieved from the tutor knowledge base based on the user's latest message.
When they are relevant, ground your explanation in them. If none apply well, use your general teaching knowledge and do not invent facts beyond what is given below.

${blocks.join('\n\n')}
</retrieved_knowledge>
`.trim();
}
