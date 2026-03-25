/**
 * 字典工具模块 — Function Calling 的核心
 *
 * 这个文件是实现 Function Calling 的三个关键角色：
 *
 * 1. dictionaryTool  —— "菜单"（告诉 LLM 有什么工具可以点）
 *    用 JSON Schema 格式描述函数的名称、用途、参数，LLM 通过这份描述来决定何时调用。
 *
 * 2. lookupWord()    —— "厨房"（真正干活的地方）
 *    接收 LLM 点的"菜"（单词），去真实的字典 API 取数据，处理后端上。
 *
 * 3. executeToolCall() —— "服务员"（负责把点单分配到对应厨师）
 *    目前只有一道菜，但这个路由设计方便未来扩展更多工具（如发音查询、例句搜索等）。
 */

import { ChatCompletionTool } from 'openai/resources';

// ─────────────────────────────────────────────────────────────────
// Part 1：Tool 定义 — 告诉 LLM "你有这个工具可以用"
// ─────────────────────────────────────────────────────────────────

/**
 * dictionaryTool 是提交给 OpenAI API 的 tool 描述对象。
 *
 * LLM 通过阅读这份描述（name + description + parameters）来判断：
 * "用户问的问题，是否需要我调用这个工具来获取准确答案？"
 *
 * 关键字段说明：
 * - name:        LLM 调用时会返回这个字符串，我们用它来路由到正确的函数
 * - description: LLM 理解工具用途的依据，越准确 LLM 调用越精准
 * - parameters:  告诉 LLM 调用时需要传什么参数（标准 JSON Schema 格式）
 */
export const dictionaryTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'lookupWord',
    description:
      '查询英语单词的详细定义、音标、例句和同义词。当用户询问某个英语单词的含义、用法时使用此工具，获取准确的字典数据。',
    parameters: {
      type: 'object',
      properties: {
        word: {
          type: 'string',
          description: '要查询的英语单词，只传单个单词，不含标点和空格',
        },
      },
      required: ['word'],
    },
  },
};

// ─────────────────────────────────────────────────────────────────
// Part 2：实际执行函数 — 调用免费字典 API 并格式化返回
// ─────────────────────────────────────────────────────────────────

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
  const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;

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

// ─────────────────────────────────────────────────────────────────
// Part 3：工具路由函数 — 按函数名分发执行
// ─────────────────────────────────────────────────────────────────

/**
 * 根据 LLM 返回的函数名，路由到对应的实现函数。
 *
 * 为什么需要这层路由？
 * LLM 的 tool_call 只返回一个字符串函数名（如 "lookupWord"），
 * 我们需要把这个字符串映射到真实的 JS 函数。
 * 这层路由设计也方便未来新增工具：只需在这里加一个 else if 分支。
 *
 * @param name LLM 返回的函数名
 * @param args LLM 返回的参数对象（已从 JSON 字符串解析完毕）
 * @returns 函数执行结果字符串，将作为 tool message 传回给 LLM
 */
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === 'lookupWord') {
    return lookupWord(args.word as string);
  }

  // 未知工具名，返回错误提示（不应该触发，除非 LLM 产生了幻觉函数名）
  return `Unknown tool: "${name}". No action taken.`;
}

// ─────────────────────────────────────────────────────────────────
// 内部类型定义 — 用于解析 Free Dictionary API 返回的 JSON
// ─────────────────────────────────────────────────────────────────

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
