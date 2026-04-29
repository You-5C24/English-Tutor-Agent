import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Button } from './ui/button';

export interface ChatInputProps {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
}

/**
 * 底部输入区：圆角框内嵌 textarea + 发送，多行增高时按钮贴在右下角，不单独占一列。
 * 流式中 textarea 仍可编辑；发送/停止二选一；流式时 doSend 为 no-op 且不清空输入。
 */
export function ChatInput({ isStreaming, onSend, onStop }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 先置 0 再取 scrollHeight，删行时才能缩回单行高度
  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [input, syncTextareaHeight]);

  const doSend = () => {
    if (isStreaming) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        doSend();
      }}
      className="flex shrink-0 border-t p-4"
    >
      <div className="flex min-w-0 flex-1 items-end gap-1 rounded-lg border border-border bg-background py-1.5 pl-3 pr-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
        <textarea
          ref={textareaRef}
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
          rows={1}
          className="min-h-9 min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5 pr-1 text-sm leading-snug outline-none placeholder:text-muted-foreground"
        />
        <div className="shrink-0 self-end pb-px">
          {isStreaming && onStop ? (
            <Button type="button" size="sm" variant="destructive" onClick={onStop}>
              停止
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={isStreaming || !input.trim()}>
              发送
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
