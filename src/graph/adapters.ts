import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatCompletionMessageParam } from 'openai/resources';

/**
 * 将 Session.history (ChatCompletionMessageParam[]) 转为 BaseMessage[]。
 * 用于 graph.invoke() 前的输入准备。
 */
export function sessionHistoryToBaseMessages(
  history: ChatCompletionMessageParam[]
): BaseMessage[] {
  return history.map((msg) => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage({ content: msg.content as string });
      case 'assistant':
        return new AIMessage({ content: (msg.content as string) ?? '' });
      case 'system':
        return new SystemMessage({ content: msg.content as string });
      default:
        return new HumanMessage({ content: String(msg.content) });
    }
  });
}

/**
 * 将 BaseMessage[] 转回 ChatCompletionMessageParam[]。
 * 用于 graph.invoke() 后写回 Session.history。
 */
export function baseMessagesToSessionHistory(
  messages: BaseMessage[]
): ChatCompletionMessageParam[] {
  return messages.map((msg): ChatCompletionMessageParam => {
    if (msg.type === 'human') {
      return { role: 'user', content: msg.content as string };
    }
    if (msg.type === 'ai') {
      return { role: 'assistant', content: (msg.content as string) ?? '' };
    }
    if (msg.type === 'system') {
      return { role: 'system', content: msg.content as string };
    }
    return { role: 'user', content: String(msg.content) };
  });
}
