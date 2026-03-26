/**
 * 意图分类器（Router）
 *
 * 这是整个 Agent 的"大脑第一步"——在生成回复之前，先用一次轻量的 LLM 调用
 * 判断用户输入属于哪个教学场景。分类结果决定了后续注入哪套 CoT 和 Few-shot。
 *
 * 工作流程：用户输入 → classify() → 返回场景标签 → chat-service 根据标签动态组装 Prompt
 *
 * 为什么不用正则/关键词匹配？
 * 因为像 "I go to school yesterday" 这样的语法错误没有明显关键词，
 * 只有 LLM 才能理解语义并正确归类为 GRAMMAR_CORRECTION。
 */
import { client } from './client.js';
import { CHAT_MODEL } from './config.js';

export type Scenario = 'VOCABULARY' | 'GRAMMAR_CORRECTION' | 'EXPRESSION' | 'OFF_TOPIC';

const VALID_SCENARIOS: Scenario[] = ['VOCABULARY', 'GRAMMAR_CORRECTION', 'EXPRESSION', 'OFF_TOPIC'];

/**
 * 分类用的 Prompt 模板。
 * 关键设计：要求模型"只返回类别名，不要返回其他内容"，
 * 这样返回值可以直接用作代码中的字符串匹配，无需额外解析。
 * 整个 Prompt 约 100 tokens，非常轻量。
 */
const classifyPrompt = (userMessage: string) => `
Classify the following user message into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- VOCABULARY: asking about word meanings, usage, or differences between similar words
- GRAMMAR_CORRECTION: writing English text that contains grammar, spelling, or usage errors
- EXPRESSION: asking how to say something in English (often translating from Chinese)
- OFF_TOPIC: anything unrelated to English learning

User message: "${userMessage}"
`.trim();

/**
 * 调用 LLM 对用户输入进行场景分类。
 * 如果模型返回了不在预定义列表中的值，兜底返回 OFF_TOPIC（安全默认值）。
 */
export async function classify(userMessage: string): Promise<Scenario> {
  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content: classifyPrompt(userMessage),
      },
    ],
  });

  const result = (completion.choices[0].message.content ?? '').trim();

  if (VALID_SCENARIOS.includes(result as Scenario)) {
    return result as Scenario;
  }

  // 兜底策略：无法识别的场景一律当作 OFF_TOPIC，避免注入错误的 CoT/Few-shot
  return 'OFF_TOPIC';
}
