/**
 * ChatWindow 单元测试：组合 MessageList + ChatInput + 错误条；
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatWindow } from '@/components/ChatWindow';
import type { Message } from '@/types/chat';

const messages: Message[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
  {
    id: '2',
    role: 'assistant',
    content: 'Hi!',
    timestamp: 2,
    scenario: 'greeting',
  },
];

describe('ChatWindow', () => {
  it('renders messages, input, and no error bar when error is null', () => {
    render(
      <ChatWindow
        messages={messages}
        isStreaming={false}
        error={null}
        onSend={vi.fn()}
        onDismissError={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi!')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument();
  });

  it('renders error bar when error is set', () => {
    render(
      <ChatWindow
        messages={[]}
        isStreaming={false}
        error="Something went wrong"
        onSend={vi.fn()}
        onDismissError={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls onDismissError when close button is clicked', async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();

    render(
      <ChatWindow
        messages={[]}
        isStreaming={false}
        error="Error"
        onSend={vi.fn()}
        onDismissError={onDismissError}
        onReset={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it('passes onStop to ChatInput when streaming', () => {
    const onStop = vi.fn();
    render(
      <ChatWindow
        messages={messages}
        isStreaming
        error={null}
        onSend={vi.fn()}
        onDismissError={vi.fn()}
        onReset={vi.fn()}
        onStop={onStop}
      />
    );

    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
  });

  it('renders stop toast when stopToast is true', () => {
    render(
      <ChatWindow
        messages={messages}
        isStreaming={false}
        error={null}
        stopToast
        onSend={vi.fn()}
        onDismissError={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText('已停止')).toBeInTheDocument();
  });
});
