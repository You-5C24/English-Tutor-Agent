import type { Message } from '../types/chat';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onDismissError: () => void;
  onReset: () => void;
}

/** 聊天主容器：顶部标题栏（含重新开始）+ 可选错误条 + 消息列表 + 底部输入。 */
export function ChatWindow({
  messages,
  isLoading,
  error,
  onSend,
  onDismissError,
  onReset,
}: ChatWindowProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-medium">English Tutor</h1>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          重新开始
        </button>
      </div>
      {error && (
        <div className="flex shrink-0 items-center justify-between bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span>{error}</span>
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
