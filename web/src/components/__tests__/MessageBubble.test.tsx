/**
 * MessageBubble 单元测试：
 * - 基础：文案、用户/助手对齐、用户多行纯文本（whitespace-pre-wrap）
 * - Markdown：仅助手消息解析；粗体/斜体/列表/多段、prose 排版、用户侧不解析、防 script 注入
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from '@/components/MessageBubble';
import type { Message } from '@/types/chat';

// 固定 fixture，避免 timestamp 波动影响快照类测试（本文件未做快照，仅语义清晰）
const userMessage: Message = {
  id: '1',
  role: 'user',
  content: 'Hello teacher',
  timestamp: Date.now(),
};

const assistantMessage: Message = {
  id: '2',
  role: 'assistant',
  content: 'Hello! How can I help you?',
  timestamp: Date.now(),
  scenario: 'greeting',
};

describe('MessageBubble', () => {
  // 用户消息：正文应出现在文档中
  it('renders user message content', () => {
    render(<MessageBubble message={userMessage} />);
    expect(screen.getByText('Hello teacher')).toBeInTheDocument();
  });

  // 助手消息：正文应出现在文档中
  it('renders assistant message content', () => {
    render(<MessageBubble message={assistantMessage} />);
    expect(screen.getByText('Hello! How can I help you?')).toBeInTheDocument();
  });

  // 布局：用户右对齐、助手左对齐（通过外层 flex 容器的 utility class 约定）
  it('applies different alignment for user vs assistant', () => {
    const { container: userContainer } = render(
      <MessageBubble message={userMessage} />
    );
    const { container: assistantContainer } = render(
      <MessageBubble message={assistantMessage} />
    );

    const userWrapper = userContainer.firstElementChild as HTMLElement;
    const assistantWrapper =
      assistantContainer.firstElementChild as HTMLElement;

    expect(userWrapper.className).toContain('justify-end');
    expect(assistantWrapper.className).toContain('justify-start');
  });

  // 用户消息：不按 Markdown 解析；用 whitespace-pre-wrap 保留原文换行
  it('preserves line breaks in user messages as plain text', () => {
    const msg: Message = {
      id: 'user-multiline',
      role: 'user',
      content: 'line one\nline two',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    const p = container.querySelector('p');
    expect(p).toHaveClass('whitespace-pre-wrap');
    expect(p?.textContent).toContain('line one');
    expect(p?.textContent).toContain('line two');
  });
});

// 助手消息走 react-markdown + prose；下列用例对用户 role 不适用
describe('MessageBubble — Markdown rendering', () => {
  // 粗体：**text** → <strong>
  it('renders **bold** as <strong> for assistant messages', () => {
    const msg: Message = {
      id: 'md-1',
      role: 'assistant',
      content: '**Bold text**',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    const strong = container.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent('Bold text');
  });

  // 斜体：*text* → <em>
  it('renders *italic* as <em> for assistant messages', () => {
    const msg: Message = {
      id: 'md-2',
      role: 'assistant',
      content: '*italic text*',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    const em = container.querySelector('em');
    expect(em).toBeInTheDocument();
    expect(em).toHaveTextContent('italic text');
  });

  // 无序列表：GFM 风格行首 `- `
  it('renders unordered list for assistant messages', () => {
    const msg: Message = {
      id: 'md-3',
      role: 'assistant',
      content: '- item one\n- item two',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector('ul')).toBeInTheDocument();
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('item one');
    expect(items[1]).toHaveTextContent('item two');
  });

  // 有序列表：`1.` `2.` …
  it('renders ordered list for assistant messages', () => {
    const msg: Message = {
      id: 'md-4',
      role: 'assistant',
      content: '1. first\n2. second',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    const ol = container.querySelector('ol');
    expect(ol).toBeInTheDocument();
    const items = ol!.querySelectorAll('li');
    expect(items).toHaveLength(2);
  });

  // 用户消息：*、** 原样显示，不产生 strong/em
  it('does NOT render Markdown for user messages', () => {
    const msg: Message = {
      id: 'md-5',
      role: 'user',
      content: '**not bold** *not italic*',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector('strong')).not.toBeInTheDocument();
    expect(container.querySelector('em')).not.toBeInTheDocument();
    expect(screen.getByText('**not bold** *not italic*')).toBeInTheDocument();
  });

  // Tailwind Typography：助手内容外层需带 prose 以便排版
  it('applies prose class to assistant message container', () => {
    const msg: Message = {
      id: 'md-6',
      role: 'assistant',
      content: 'Hello',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    const proseEl = container.querySelector('.prose');
    expect(proseEl).toBeInTheDocument();
  });

  // 空行分隔段落 → 多个 <p>（与 LLM 多段回复一致）
  it('renders separate paragraphs when assistant content has a blank line', () => {
    const msg: Message = {
      id: 'md-para',
      role: 'assistant',
      content: 'First paragraph.\n\nSecond paragraph.',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    const ps = container.querySelectorAll('p');
    expect(ps.length).toBeGreaterThanOrEqual(2);
    expect(ps[0]).toHaveTextContent(/First paragraph/);
    expect(ps[ps.length - 1]).toHaveTextContent(/Second paragraph/);
  });

  // 安全：不通过 innerHTML 注入；内容中的 <script> 不得进 DOM（对齐设计文档 3.3）
  it('does not create script elements from raw HTML in assistant content', () => {
    const msg: Message = {
      id: 'md-xss',
      role: 'assistant',
      content: 'Hi <script>document.body.dataset.xss="1"</script> there',
      timestamp: Date.now(),
    };
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector('script')).toBeNull();
  });
});
