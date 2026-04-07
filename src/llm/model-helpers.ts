import { ChatCompletionMessageParam } from 'openai/resources';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

/**
 * 将 OpenAI SDK 的消息格式转为 LangChain BaseMessage 数组。
 * 这是 Phase 0 的桥梁函数：让现有代码的消息构建逻辑不变，
 * 只在调用 LLM 前做一次批量转换。
 */
export function toBaseMessages(
  messages: ChatCompletionMessageParam[]
): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage({ content: msg.content as string });
      case 'assistant':
        return new AIMessage({ content: (msg.content as string) ?? '' });
      case 'system':
        return new SystemMessage({ content: msg.content as string });
      case 'tool':
        return new ToolMessage({
          content: msg.content as string,
          tool_call_id: (msg as { tool_call_id: string }).tool_call_id,
        });
      default:
        return new HumanMessage({ content: String(msg.content) });
    }
  });
}

/**
 * 从 AIMessage 中提取文本内容。
 * AIMessage.content 可能是 string 或 ContentPart[]，
 * 这里只处理 string 场景（本项目不涉及多模态）。
 */
export function fromAIMessage(msg: AIMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  return '';
}
