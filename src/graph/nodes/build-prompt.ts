import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatCompletionMessageParam } from 'openai/resources';
import { baseSystemPrompt } from '@/prompts/base';
import { vocabularyCot, vocabularyFewShot } from '@/prompts/vocabulary';
import { grammarCot, grammarFewShot } from '@/prompts/grammar';
import { expressionCot, expressionFewShot } from '@/prompts/expression';
import { offTopicCot } from '@/prompts/offTopic';
import { formatRagContext } from '@/prompts/rag';
import { retrieveFromChroma, isChromaReady } from '@/rag/chroma-store';
import { RAG_TOP_K, RAG_MIN_SCORE } from '@/config';
import type { Scenario } from '@/classifier';
import type { TutorStateType } from '@/graph/state';

/** 与 chat-service 一致：每场景一套 CoT + Few-shot（OpenAI 消息格式，需转成 BaseMessage） */
const scenarioConfig: Record<
  Scenario,
  { cot: string; fewShot: ChatCompletionMessageParam[] }
> = {
  VOCABULARY: { cot: vocabularyCot, fewShot: vocabularyFewShot },
  GRAMMAR_CORRECTION: { cot: grammarCot, fewShot: grammarFewShot },
  EXPRESSION: { cot: expressionCot, fewShot: expressionFewShot },
  OFF_TOPIC: { cot: offTopicCot, fewShot: [] },
};

/** 将 prompts 里的 few-shot 示例转为 LangChain 消息，供图状态与 LLM invoke 使用 */
function fewShotToBaseMessages(
  fewShot: ChatCompletionMessageParam[]
): BaseMessage[] {
  return fewShot.map((msg): BaseMessage => {
    if (msg.role === 'user')
      return new HumanMessage({ content: msg.content as string });
    if (msg.role === 'assistant')
      return new AIMessage({ content: (msg.content as string) ?? '' });
    return new SystemMessage({ content: msg.content as string });
  });
}

/**
 * 组装本轮发给模型的消息：base + 场景 CoT、压缩摘要、（可选）RAG、few-shot、压缩后的历史与当前用户句。
 * 同时写出 systemPrompt / fewShot / hasTools，供后续节点或调试使用。
 */
export async function buildPromptNode(state: TutorStateType): Promise<{
  systemPrompt: string;
  fewShot: BaseMessage[];
  hasTools: boolean;
  messages: BaseMessage[];
}> {
  const { scenario, compressedSummary, compressedHistory, userMessage } = state;
  const { cot, fewShot } = scenarioConfig[scenario];

  let systemPrompt = baseSystemPrompt + '\n\n' + cot;

  if (compressedSummary) {
    systemPrompt += `\n\n[历史摘要] ${compressedSummary}`;
  }

  if (scenario !== 'OFF_TOPIC' && isChromaReady()) {
    try {
      const top = (await retrieveFromChroma(userMessage, RAG_TOP_K)).filter(
        (t) => t.score >= RAG_MIN_SCORE
      );
      if (top.length > 0) {
        systemPrompt += '\n\n' + formatRagContext(top);
        console.log(`  [RAG] 已注入 ${top.length} 条`);
      }
    } catch (err) {
      console.warn('  [RAG] 检索失败，跳过上下文注入:', err);
    }
  }

  const initialMessages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...fewShotToBaseMessages(fewShot),
    ...compressedHistory,
    new HumanMessage(userMessage),
  ];

  return {
    systemPrompt,
    fewShot: fewShotToBaseMessages(fewShot),
    hasTools: scenario === 'VOCABULARY',
    messages: initialMessages,
  };
}
