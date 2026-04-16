import { ToolMessage } from '@langchain/core/messages';
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { dictionaryTool } from '@/tools/dictionary';
import type { TutorStateType } from '@/graph/state';

type ExecuteToolsNodeResult = {
  messages: BaseMessage[];
  toolIterations: number;
};

/**
 * 工具执行节点：读取最后一条 AI 消息的 tool_calls，执行工具，返回结果。
 * 每次执行后 toolIterations + 1，供条件边判断是否终止循环。
 */
export async function executeToolsNode(
  state: TutorStateType
): Promise<ExecuteToolsNodeResult> {
  const lastMessage = state.messages.at(-1) as AIMessage;
  const toolCalls = lastMessage.tool_calls ?? [];
  const toolMessages: ToolMessage[] = [];

  for (const toolCall of toolCalls) {
    console.log(
      `  [Tool] 调用函数: ${toolCall.name}(${JSON.stringify(toolCall.args)})`
    );
    const result = await dictionaryTool.invoke(toolCall.args);
    console.log(
      `  [Tool] 执行结果: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`
    );
    toolMessages.push(
      new ToolMessage({ content: result, tool_call_id: toolCall.id ?? '' })
    );
  }

  return {
    messages: toolMessages,
    toolIterations: (state.toolIterations ?? 0) + 1,
  };
}
