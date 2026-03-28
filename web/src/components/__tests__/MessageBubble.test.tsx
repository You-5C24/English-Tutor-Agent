/**
 * MessageBubble 单元测试：校验文案渲染与用户/助手气泡在布局类名上的差异。
 * Step 1 阶段组件尚未实现，运行测试应失败（找不到 ../MessageBubble）。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from '@/components/MessageBubble';
import type { Message } from '../../types/chat';

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
});
