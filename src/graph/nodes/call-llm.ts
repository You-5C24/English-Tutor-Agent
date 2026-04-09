import { chatModel } from '@/llm/model';
import { fromAIMessage } from '@/llm/model-helpers';
import { dictionaryTool } from '@/tools/dictionary';
import { MAX_TOOL_ITERATIONS } from '@/config';
import { ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { TutorStateType } from '@/graph/state';

type CallLLMNodeResult = {
  messages: BaseMessage[];
  reply: string;
};

/**
 * Phase 1：在节点内完成工具循环（与 chat-service 的 runToolLoop 对齐）。
 * 读入 buildPrompt 拼好的 state.messages，按需绑定字典工具，直到模型返回纯文本或触达迭代上限。
 */
export async function callLLMNode(
  state: TutorStateType
): Promise<CallLLMNodeResult> {
  const model = state.hasTools
    ? chatModel.bindTools([dictionaryTool])
    : chatModel;

  let loopMessages = [...state.messages];
  let iterations = 0;

  while (true) {
    iterations++;
    if (iterations > MAX_TOOL_ITERATIONS) {
      console.log(
        `  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`
      );
      break;
    }

    const response = await model.invoke(loopMessages);
    loopMessages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        console.log(
          `  [Tool] 调用函数: ${toolCall.name}(${JSON.stringify(
            toolCall.args
          )})`
        );
        const toolResult = await dictionaryTool.invoke(toolCall.args);
        console.log(
          `  [Tool] 执行结果: ${toolResult.slice(0, 100)}${
            toolResult.length > 100 ? '...' : ''
          }`
        );
        loopMessages.push(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id ?? '',
          })
        );
      }
      continue;
    }

    return { messages: loopMessages, reply: fromAIMessage(response) };
  }

  // 触达上限：取对话里最后一条 AI 消息作回复，避免 state 里无可用文本
  const lastAI = loopMessages.filter((m) => m.type === 'ai').pop();
  return {
    messages: loopMessages,
    reply: lastAI
      ? (lastAI.content as string) ?? ''
      : '抱歉，我暂时无法完成查询，请稍后再试。',
  };
}
