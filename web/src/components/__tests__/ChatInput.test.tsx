/**
 * ChatInput 单元测试：占位符、发送/回车行为、加载与空内容禁用逻辑。
 * Step 1 阶段组件尚未实现，运行测试应失败（找不到 ../ChatInput）。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatInput } from '@/components/ChatInput';

describe('ChatInput', () => {
  // 基础结构：多行输入 + 发送按钮，便于无障碍与交互测试
  it('renders textarea and send button', () => {
    render(<ChatInput isLoading={false} onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  // 点击发送：trim 后交给 onSend，并清空受控输入
  it('calls onSend with trimmed text and clears input on submit', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isLoading={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, '  Hello teacher  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSend).toHaveBeenCalledWith('Hello teacher');
    expect(textarea).toHaveValue('');
  });

  // 回车提交；不按 Shift 时与点击发送等价
  it('submits on Enter key (without Shift)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isLoading={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'Hello');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  // Shift+Enter 仅换行，不触发发送（与常见 IM 行为一致）
  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isLoading={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'Hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSend).not.toHaveBeenCalled();
  });

  // 请求进行中：禁止再次输入与提交，避免重复发送
  it('disables textarea and button when loading', () => {
    render(<ChatInput isLoading={true} onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('输入消息...')).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  // 无有效内容时按钮不可用（trim 后为空）
  it('disables send button when input is empty', () => {
    render(<ChatInput isLoading={false} onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  // 仅空白：即使误点也不应调用 onSend（与按钮 disabled 策略一致）
  it('does not call onSend when input is only whitespace', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isLoading={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, '   ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSend).not.toHaveBeenCalled();
  });
});
