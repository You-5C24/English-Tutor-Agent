import type { Message } from '../types/chat';

interface MessageBubbleProps {
  message: Message;
}

/** 单条聊天消息：用户靠右主色气泡，助手靠左 muted 气泡。 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        {/* whitespace-pre-wrap：保留用户输入的换行 */}
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}
