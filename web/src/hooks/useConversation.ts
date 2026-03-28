import { useState, useCallback } from 'react';
import type { Message } from '../types/chat';
import { sendChatMessage, ChatApiError } from '../api/chat';

export interface UseConversationReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
}

/**
 * 管理一轮对话：本地消息列表、与后端的 sessionId、发送中的加载态与可展示错误。
 */
export function useConversation(): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    // 避免重复提交；空白不上屏、不调 API
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendChatMessage({ message: trimmed, sessionId });

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
        scenario: response.scenario,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setSessionId(response.sessionId);
    } catch (err) {
      if (err instanceof ChatApiError) {
        if (err.code === 'SESSION_NOT_FOUND') {
          setError('会话已过期，请重新发送消息开始新对话');
          setSessionId(undefined);
        } else {
          setError(err.message);
        }
      } else {
        setError('网络连接失败，请检查网络后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sessionId]);

  const clearError = useCallback(() => setError(null), []);

  return { messages, isLoading, error, sendMessage, clearError };
}
