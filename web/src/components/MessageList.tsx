import { useRef, useEffect } from 'react';
import type { Message } from '../types/chat';
import { MessageBubble } from './MessageBubble';
import { ScrollArea } from './ui/scroll-area';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

/** 可滚动消息区：列表 + 加载占位；新消息时平滑滚到底部锚点。 */
export function MessageList({ messages, isLoading }: MessageListProps) {
  // 不触发重渲染的 DOM 引用，仅用于滚动到底部
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <ScrollArea className="min-h-0 flex-1 p-4">
      <div className="space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-4 py-2">
              <p className="text-sm text-muted-foreground">正在思考...</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
