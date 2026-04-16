import type { BaseMessage } from '@langchain/core/messages';
import { chatModel } from '@/llm/model';
import { fromAIMessage } from '@/llm/model-helpers';
import { dictionaryTool } from '@/tools/dictionary';
import type { TutorStateType } from '@/graph/state';

type CallLLMNodeResult = {
  messages: BaseMessage[];
  reply: string;
};

/**
 * Phase 3 版本：单次 LLM 调用。循环由图级边控制。
 * 如果有 tool_calls，条件边会路由到 executeTools，然后回到这里。
 */
export async function callLLMNode(
  state: TutorStateType
): Promise<CallLLMNodeResult> {
  const model = state.hasTools
    ? chatModel.bindTools([dictionaryTool])
    : chatModel;

  const response = await model.invoke(state.messages);

  const reply =
    !response.tool_calls || response.tool_calls.length === 0
      ? fromAIMessage(response)
      : '';

  return {
    messages: [response],
    reply,
  };
}
