import { useRef, useEffect } from 'react';
import type { Message } from '../types/chat';
import { MessageBubble } from './MessageBubble';
import { ScrollArea } from './ui/scroll-area';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
}

/** 可滚动消息区；流式时在最后一条助手消息后显示打字光标；新消息时平滑滚到底部锚点。 */
export function MessageList({ messages, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const last = messages[messages.length - 1];
  const cursorOnLastAssistant =
    isStreaming && last != null && last.role === 'assistant';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <ScrollArea className="min-h-0 flex-1 p-4">
      <div className="space-y-4">
        {messages.map((msg, index) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            showStreamingCursor={
              cursorOnLastAssistant && index === messages.length - 1
            }
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
