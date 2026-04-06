import { useState, useCallback, useEffect } from 'react';
import type { Message } from '../types/chat';
import { sendChatMessage, fetchHistory, resetConversation as apiReset, ChatApiError } from '../api/chat';

function newMessageId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface UseConversationReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
  resetConversation: () => Promise<void>;
}

/**
 * 管理对话：挂载时从后端加载历史消息，发送消息时追加到列表，
 * 支持重置对话清空记忆。
 */
export function useConversation(): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchHistory({ signal: controller.signal })
      .then((res) => {
        setMessages(res.messages);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'AbortError') return;
        /* 历史加载失败静默处理，用户可正常开始新对话 */
      });

    return () => {
      controller.abort();
    };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: newMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendChatMessage({ message: trimmed });

      const assistantMessage: Message = {
        id: newMessageId(),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
        scenario: response.scenario,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      if (err instanceof ChatApiError) {
        setError(err.message);
      } else {
        setError('网络连接失败，请检查网络后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const clearError = useCallback(() => setError(null), []);

  const handleReset = useCallback(async () => {
    try {
      await apiReset();
      setMessages([]);
      setError(null);
    } catch {
      setError('重置失败，请稍后重试');
    }
  }, []);

  return { messages, isLoading, error, sendMessage, clearError, resetConversation: handleReset };
}
