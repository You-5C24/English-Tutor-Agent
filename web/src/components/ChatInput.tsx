import { useState } from 'react';
import { Button } from './ui/button';

interface ChatInputProps {
  isLoading: boolean;
  onSend: (text: string) => void;
}

/** 底部输入区：受控 textarea + 发送；Enter 提交、Shift+Enter 换行。 */
export function ChatInput({ isLoading, onSend }: ChatInputProps) {
  const [input, setInput] = useState('');

  const doSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        doSend();
      }}
      className="flex gap-2 p-4 border-t"
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // 与常见聊天应用一致：单独 Enter 发送，Shift+Enter 插入换行
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
          }
        }}
        placeholder="输入消息..."
        disabled={isLoading}
        rows={1}
        className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <Button type="submit" disabled={isLoading || !input.trim()}>
        发送
      </Button>
    </form>
  );
}
