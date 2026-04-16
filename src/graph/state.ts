import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { Scenario } from '@/classifier';

/**
 * 图的全局状态定义。
 * 每个节点从 State 中读取输入字段，返回要更新的输出字段。
 * messages 使用 reducer（追加模式），其余字段为覆盖模式。
 */
export const TutorState = Annotation.Root({
  userMessage: Annotation<string>,

  scenario: Annotation<Scenario>,

  history: Annotation<BaseMessage[]>,
  summary: Annotation<string>,
  compressedHistory: Annotation<BaseMessage[]>,
  compressedSummary: Annotation<string>,

  systemPrompt: Annotation<string>,
  fewShot: Annotation<BaseMessage[]>,
  hasTools: Annotation<boolean>,

  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...(current ?? []), ...update],
    default: () => [],
  }),

  toolIterations: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),

  reply: Annotation<string>,
});

export type TutorStateType = typeof TutorState.State;
