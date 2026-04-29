/**
 * ChatInput 单元测试：占位符、发送/回车行为、流式与空内容禁用逻辑。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatInput } from '@/components/ChatInput';

describe('ChatInput', () => {
  // 基础结构：多行输入 + 发送按钮，便于无障碍与交互测试
  it('renders textarea and send button', () => {
    render(<ChatInput isStreaming={false} onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  // 点击发送：trim 后交给 onSend，并清空受控输入
  it('calls onSend with trimmed text and clears input on submit', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isStreaming={false} onSend={onSend} />);

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
    render(<ChatInput isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'Hello');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  // Shift+Enter 仅换行，不触发发送（与常见 IM 行为一致）
  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'Hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSend).not.toHaveBeenCalled();
  });

  // 流式中：输入区不禁用；有 onStop 时显示停止按钮
  it('keeps textarea enabled and shows stop when streaming with onStop', () => {
    const onStop = vi.fn();
    render(<ChatInput isStreaming onSend={vi.fn()} onStop={onStop} />);

    expect(screen.getByPlaceholderText('输入消息...')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
  });

  it('calls onStop when stop button is clicked', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ChatInput isStreaming onSend={vi.fn()} onStop={onStop} />);

    await user.click(screen.getByRole('button', { name: '停止' }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  // 流式但无 onStop：仍显示发送且禁用，textarea 可输入下一条草稿
  it('disables send only when streaming without onStop', () => {
    render(<ChatInput isStreaming onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('输入消息...')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  // 无有效内容时按钮不可用（trim 后为空）
  it('disables send button when input is empty', () => {
    render(<ChatInput isStreaming={false} onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  // 仅空白：即使误点也不应调用 onSend（与按钮 disabled 策略一致）
  it('does not call onSend when input is only whitespace', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, '   ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSend).not.toHaveBeenCalled();
  });

  // 流式中 Enter / 提交路径不调用 onSend、不清空
  it('does not send or clear when streaming', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isStreaming onSend={onSend} onStop={vi.fn()} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'draft');
    await user.keyboard('{Enter}');

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('draft');
  });
});
