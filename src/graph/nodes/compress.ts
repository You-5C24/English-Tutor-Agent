import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { summaryModel } from '@/llm/model';
import { fromAIMessage } from '@/llm/model-helpers';
import { COMPRESS_THRESHOLD, KEEP_RECENT_ROUNDS } from '@/config';
import type { TutorStateType } from '@/graph/state';

/**
 * 上下文压缩节点：轮数超过阈值时，用摘要模型把较早对话压成短摘要，
 * 仅保留最近若干轮原始消息，供后续 buildPrompt 使用 compressed* 字段。
 */
export async function compressNode(
  state: TutorStateType
): Promise<{
  compressedHistory: BaseMessage[];
  compressedSummary: string;
}> {
  const { history, summary } = state;
  const totalRounds = history.length / 2;

  if (totalRounds < COMPRESS_THRESHOLD) {
    return { compressedHistory: history, compressedSummary: summary };
  }

  console.log(
    `  ⚡ [Memory] 触发压缩! ${totalRounds} 轮 > 阈值 ${COMPRESS_THRESHOLD} 轮`
  );

  // 每轮 = user + assistant 两条消息
  const keepMessages = KEEP_RECENT_ROUNDS * 2;
  const oldMessages = history.slice(0, -keepMessages);
  const recentMessages = history.slice(-keepMessages);

  const conversationText = oldMessages
    .map((m) => `${m.type}: ${m.content}`)
    .join('\n');

  const summaryPromptText = summary
    ? `以下是之前的对话摘要：\n${summary}\n\n以下是最近的对话内容：\n${conversationText}\n\n请将以上所有信息总结成1-2句话的摘要，用中文概括主要讨论内容和用户的学习重点。`
    : `请总结以下对话的关键信息，用1-2句话概括主要讨论内容和用户的学习重点。\n\n${conversationText}`;

  const response = await summaryModel.invoke([
    new SystemMessage(
      '你是一个对话摘要助手。请用简洁的中文总结对话内容，保留关键学习点和用户水平信息。'
    ),
    new HumanMessage(summaryPromptText),
  ]);

  const newSummary = fromAIMessage(response).trim();
  console.log(`  [Memory] LLM 返回的摘要: "${newSummary}"`);

  return { compressedHistory: recentMessages, compressedSummary: newSummary };
}
