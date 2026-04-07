import { ChatOpenAI } from '@langchain/openai';
import { CHAT_MODEL, SUMMARY_MAX_TOKENS } from '../config.js';

const moonshotLlmFields = {
  configuration: {
    baseURL: 'https://api.moonshot.cn/v1',
  },
  apiKey: process.env.MOONSHOT_API_KEY,
  model: CHAT_MODEL,
};

/**
 * 主对话模型 - 通过 OpenAI 兼容接口连接 Moonshot。
 * ChatOpenAI 的 configuration.baseURL 让它指向 Moonshot 而非 OpenAI。
 * 所有需要 LLM 的地方（分类、主对话、摘要）复用这一个实例。
 */
export const chatModel = new ChatOpenAI(moonshotLlmFields);

/**
 * 摘要专用模型 - 限制输出长度并关闭 Moonshot thinking（kimi-k2.5 默认 thinking 可能导致摘要为空）。
 * 使用独立实例：completions 路径从实例字段读取 maxTokens，仅 withConfig/defaultOptions 不会生效。
 * Moonshot 扩展字段经 modelKwargs 进入请求体。
 */
export const summaryModel = new ChatOpenAI({
  ...moonshotLlmFields,
  maxCompletionTokens: SUMMARY_MAX_TOKENS,
  modelKwargs: {
    thinking: { type: 'disabled' },
  },
});
