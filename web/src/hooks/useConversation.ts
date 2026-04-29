import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, StreamCallbacks, StreamHandle } from '../types/chat';
import {
  sendChatMessage,
  streamChatMessage,
  fetchHistory,
  resetConversation as apiReset,
  ChatApiError,
} from '../api/chat';

function newMessageId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 读取流式 feature flag。必须在每次发送时求值（勿做成模块顶层常量），
 * 否则 Vitest 在 `beforeEach` 里改 `import.meta.env.VITE_STREAMING` 不会生效。
 */
function readUseStreamingFlag(): boolean {
  return import.meta.env.VITE_STREAMING !== 'false';
}

export interface UseConversationReturn {
  messages: Message[];
  /** 流式或 JSON 请求进行中的统一标志 */
  isStreaming: boolean;
  /** 与旧组件兼容；等价于 `isStreaming`（后续 Task 可收敛字段名） */
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
  resetConversation: () => Promise<void>;
  /** 仅流式开启时提供：中止 SSE 并撤销本轮 user+assistant 占位 */
  stop?: () => void;
}

/**
 * 管理对话：挂载时加载历史；发送可走 SSE（`streamChatMessage`）或 JSON（`sendChatMessage`），
 * 由 `VITE_STREAMING` 控制；支持重置与流式中途 `stop`。
 */
export function useConversation(): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<StreamHandle | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

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

  const streamingSend = useCallback((trimmed: string) => {
    const userMsg: Message = {
      id: newMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    const asstMsg: Message = {
      id: newMessageId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    const assistantId = asstMsg.id;
    const userId = userMsg.id;
    currentUserIdRef.current = userId;
    currentAssistantIdRef.current = assistantId;
    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);
    setError(null);

    // 用本轮 id 闭包进回调：避免 React 批处理时读 ref 与异步 setState 回调的竞态
    const cbs: StreamCallbacks = {
      onMeta: ({ scenario }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, scenario } : m)),
        );
      },
      onToken: ({ delta }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m,
          ),
        );
      },
      onDone: ({ messageId, scenario }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, id: messageId, scenario } : m,
          ),
        );
        setIsStreaming(false);
        handleRef.current = null;
        currentAssistantIdRef.current = null;
        currentUserIdRef.current = null;
      },
      onError: ({ message }) => {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError(message);
        setIsStreaming(false);
        handleRef.current = null;
        currentAssistantIdRef.current = null;
        currentUserIdRef.current = null;
      },
    };

    const handle = streamChatMessage({ message: trimmed }, cbs);
    handleRef.current = handle;
    // 流前错误（HTTP / Content-Type / fetch）走 reject；流内 error 已由 onError 处理
    void handle?.done?.catch((err: unknown) => {
      if (handleRef.current !== handle) return;
      if (err instanceof ChatApiError) setError(err.message);
      else setError('网络连接失败，请检查网络后重试');
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      setIsStreaming(false);
      handleRef.current = null;
      currentAssistantIdRef.current = null;
      currentUserIdRef.current = null;
    });
  }, []);

  /** 与原先 JSON 路径一致：先发 user，成功后追加单条 assistant */
  const jsonSend = useCallback(async (trimmed: string) => {
    const userMessage: Message = {
      id: newMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
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
      setIsStreaming(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      if (readUseStreamingFlag()) {
        streamingSend(trimmed);
      } else {
        await jsonSend(trimmed);
      }
    },
    [isStreaming, streamingSend, jsonSend],
  );

  /** 用户取消：abort 网络层，并移除本轮占位 user+assistant（与 onError 仅删 assistant 区分） */
  const stop = useCallback(() => {
    const assistantId = currentAssistantIdRef.current;
    const userId = currentUserIdRef.current;
    handleRef.current?.abort();
    // 先快照 id 再 filter：`abort()` 可能触发下游同步清理 ref，若先 abort 再读 ref 会得到 null
    setMessages((prev) =>
      prev.filter((m) => m.id !== assistantId && m.id !== userId),
    );
    currentAssistantIdRef.current = null;
    currentUserIdRef.current = null;
    setIsStreaming(false);
    handleRef.current = null;
  }, []);

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

  return {
    messages,
    isStreaming,
    isLoading: isStreaming,
    error,
    sendMessage,
    clearError,
    resetConversation: handleReset,
    stop: readUseStreamingFlag() ? stop : undefined,
  };
}
