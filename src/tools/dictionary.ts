/**
 * 字典工具模块 — 使用 LangChain StructuredTool
 */
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * LangChain StructuredTool 版本的字典查询工具。
 * chatModel.bindTools([dictionaryTool]) 时，LangChain 自动从 schema 生成 JSON Schema。
 */
export class DictionaryTool extends StructuredTool {
  name = 'lookupWord';
  description =
    '查询英语单词的详细定义、音标、例句和同义词。当用户询问某个英语单词的含义、用法时使用此工具，获取准确的字典数据。';
  schema = z.object({
    word: z.string().describe('要查询的英语单词，只传单个单词，不含标点和空格'),
  });

  async _call({ word }: z.infer<typeof this.schema>): Promise<string> {
    return lookupWord(word);
  }
}

export const dictionaryTool = new DictionaryTool();

/**
 * 调用 Free Dictionary API 查询单词，并将结果格式化为 LLM 易于理解的文本。
 *
 * Free Dictionary API 特点：
 * - 完全免费，无需注册和 API Key
 * - 返回数据：音标、词性、释义、例句、同义词
 * - 不在词典中的单词会返回 404
 *
 * 设计原则 — 静默降级：
 * 任何错误（网络超时、单词不存在、JSON 解析失败）都不抛异常，
 * 而是返回一段指引 LLM 用自身知识回答的提示字符串。
 * 这样即使 API 挂了，用户也感知不到，对话不中断。
 *
 * @param word 要查询的英语单词
 * @returns 格式化后的字典数据字符串，供 LLM 读取和引用
 */
export async function lookupWord(word: string): Promise<string> {
  const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
    word
  )}`;

  try {
    const response = await fetch(apiUrl);

    // 单词不在词典中时 API 返回 404
    if (!response.ok) {
      return `Dictionary lookup failed for '${word}': word not found (HTTP ${response.status}). Please answer based on your own knowledge.`;
    }

    // Free Dictionary API 返回一个数组，每个元素代表该单词的一种词源/词义组
    // 通常取第一个 entry 就足够了
    const data = (await response.json()) as DictionaryEntry[];
    const entry = data[0];

    if (!entry) {
      return `Dictionary lookup failed for '${word}': empty response. Please answer based on your own knowledge.`;
    }

    // ── 提取音标 ──
    // phonetics 数组可能有多个，找第一个有 text 字段的
    const phonetic =
      entry.phonetics?.find((p) => p.text)?.text ?? entry.phonetic ?? 'N/A';

    // ── 提取词义信息 ──
    // 每个 meaning 代表一种词性（名词、动词等），每种词性下有多条释义
    const meaningsText = entry.meanings
      ?.slice(0, 3) // 最多取 3 个词性，避免内容过长
      .map((meaning) => {
        // 每个词性下取前 2 条释义
        const definitions = meaning.definitions
          .slice(0, 2)
          .map((def, idx) => {
            // 例句可能不存在，存在才附上
            const example = def.example ? ` Example: "${def.example}"` : '';
            return `  ${idx + 1}. ${def.definition}${example}`;
          })
          .join('\n');

        // 同义词：从词性层级取，最多显示 3 个
        const synonyms = meaning.synonyms?.slice(0, 3).join(', ');
        const synonymsText = synonyms ? `\n  Synonyms: ${synonyms}` : '';

        return `[${meaning.partOfSpeech}]\n${definitions}${synonymsText}`;
      })
      .join('\n\n');

    // ── 组装最终返回字符串 ──
    // 这段文字会作为 tool message 传回给 LLM，LLM 会基于此数据组织教学回复
    return `Word: ${entry.word}\nPhonetic: ${phonetic}\n\n${meaningsText}`;
  } catch (error) {
    // 兜底：网络异常、JSON 解析失败等，让 LLM 用自身知识回答
    return `Dictionary lookup failed for '${word}' due to an error. Please answer based on your own knowledge.`;
  }
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: {
    partOfSpeech: string;
    definitions: {
      definition: string;
      example?: string;
      synonyms?: string[];
    }[];
    synonyms?: string[];
  }[];
}
