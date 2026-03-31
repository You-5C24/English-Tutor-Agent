import ReactMarkdown from 'react-markdown';
import type { Message } from '../types/chat';

interface MessageBubbleProps {
  message: Message;
}

// prose modifier 说明：
// prose prose-sm — 基础排版 + 小字号，匹配 Phase 1 的 text-sm
// dark:prose-invert — 深色模式下反转文字颜色
// max-w-none — 取消 prose 默认的 max-width: 65ch 限制
// [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 — 去掉首尾元素多余边距
// prose-p:my-1 prose-ul:my-1 prose-ol:my-1 — 收紧段落和列表间距，适配紧凑的聊天气泡
const proseClasses = 'prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-p:my-1 prose-ul:my-1 prose-ol:my-1';

/** 单条聊天消息：用户靠右纯文本气泡，助手靠左 Markdown 渲染气泡。 */
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
        {/* user 消息保持纯文本，避免 *、** 等被意外解析；assistant 消息渲染 Markdown */}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className={proseClasses}>
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
