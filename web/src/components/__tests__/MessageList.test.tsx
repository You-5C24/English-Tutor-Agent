/**
 * MessageList 单元测试：消息列表渲染、加载中提示、无消息时的表现。
 * Step 1 阶段组件尚未实现，运行测试应失败（找不到 ../MessageList）。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageList } from '@/components/MessageList';
import type { Message } from '@/types/chat';

const messages: Message[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
  {
    id: '2',
    role: 'assistant',
    content: 'Hi there!',
    timestamp: 2,
    scenario: 'greeting',
  },
];

describe('MessageList', () => {
  // 每条消息应能通过正文被查到（内部通常会渲染 MessageBubble）
  it('renders all messages', () => {
    render(<MessageList messages={messages} isLoading={false} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  // 等待助手回复时展示占位文案
  it('shows loading indicator when isLoading is true', () => {
    render(<MessageList messages={messages} isLoading={true} />);
    expect(screen.getByText('正在思考...')).toBeInTheDocument();
  });

  it('does not show loading indicator when isLoading is false', () => {
    render(<MessageList messages={messages} isLoading={false} />);
    expect(screen.queryByText('正在思考...')).not.toBeInTheDocument();
  });

  // 无消息：不应出现列表中的用户首条内容（计划用此断言空列表）
  it('renders empty state when no messages', () => {
    render(<MessageList messages={[]} isLoading={false} />);
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });
});
