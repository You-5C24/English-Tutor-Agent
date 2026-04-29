/**
 * MessageList 单元测试：消息列表渲染、流式打字光标、无消息时的表现。
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
  it('renders all messages', () => {
    render(<MessageList messages={messages} isStreaming={false} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows typing cursor on last assistant when streaming', () => {
    const { container } = render(
      <MessageList messages={messages} isStreaming />
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does not show typing cursor when not streaming', () => {
    const { container } = render(
      <MessageList messages={messages} isStreaming={false} />
    );
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('does not show typing cursor when last message is user', () => {
    const userOnly: Message[] = [
      { id: '1', role: 'user', content: 'Waiting...', timestamp: 1 },
    ];
    const { container } = render(
      <MessageList messages={userOnly} isStreaming />
    );
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('does not show legacy thinking placeholder', () => {
    render(<MessageList messages={messages} isStreaming />);
    expect(screen.queryByText('正在思考...')).not.toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    render(<MessageList messages={[]} isStreaming={false} />);
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });
});
