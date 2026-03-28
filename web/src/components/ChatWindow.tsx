import type { Message } from '../types/chat';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onDismissError: () => void;
}

/** 聊天主容器：顶部可选错误条 + 消息列表 + 底部输入。 */
export function ChatWindow({
  messages,
  isLoading,
  error,
  onSend,
  onDismissError,
}: ChatWindowProps) {
  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="flex items-center justify-between bg-destructive/10 text-destructive px-4 py-2 text-sm">
          <span>{error}</span>
          {/* aria-label 与文案「✕」一致，供测试与读屏定位 */}
          <button
            type="button"
            onClick={onDismissError}
            className="ml-2 hover:opacity-70"
            aria-label="✕"
          >
            ✕
          </button>
        </div>
      )}
      <MessageList messages={messages} isLoading={isLoading} />
      <ChatInput isLoading={isLoading} onSend={onSend} />
    </div>
  );
}
