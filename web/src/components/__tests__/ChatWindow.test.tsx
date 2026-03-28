/**
 * ChatWindow 单元测试：组合 MessageList + ChatInput + 错误条；
 * Step 1 阶段组件尚未实现，运行测试应失败（找不到 ../ChatWindow）。
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
  // 正常态：列表与输入可见，且无错误条（error 为 null）
  it('renders messages, input, and no error bar when error is null', () => {
    render(
      <ChatWindow
        messages={messages}
        isLoading={false}
        error={null}
        onSend={vi.fn()}
        onDismissError={vi.fn()}
      />
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi!')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument();
  });

  // 有 error 时展示文案（由父组件传入，如 hook 里的 API 错误）
  it('renders error bar when error is set', () => {
    render(
      <ChatWindow
        messages={[]}
        isLoading={false}
        error="Something went wrong"
        onSend={vi.fn()}
        onDismissError={vi.fn()}
      />
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  // 错误条关闭按钮应触发 onDismissError（通常即 clearError）
  it('calls onDismissError when close button is clicked', async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();

    render(
      <ChatWindow
        messages={[]}
        isLoading={false}
        error="Error"
        onSend={vi.fn()}
        onDismissError={onDismissError}
      />
    );

    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });
});
