# Markdown 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 assistant 消息中的 Markdown 渲染为格式化富文本，提升英语辅导对话的可读性。

**Architecture:** 仅修改 `MessageBubble` 组件的渲染逻辑——assistant 消息使用 `react-markdown` 渲染为 React 组件树，user 消息保持纯文本不变。用 `@tailwindcss/typography` 的 `prose` 类处理排版样式。

**Tech Stack:** react-markdown, @tailwindcss/typography, Tailwind CSS v4, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-30-markdown-rendering-design.md`

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `web/package.json` | Modify | 新增 `react-markdown`、`@tailwindcss/typography` 依赖 |
| `web/src/App.css` | Modify | 添加 `@plugin "@tailwindcss/typography"` 声明 |
| `web/src/components/MessageBubble.tsx` | Modify | assistant 消息改用 `ReactMarkdown` + `prose` 渲染 |
| `web/src/components/__tests__/MessageBubble.test.tsx` | Modify | 新增 Markdown 渲染测试用例 |

不动的文件：`useConversation.ts`、`api/chat.ts`、`ChatWindow.tsx`、`MessageList.tsx`、`ChatInput.tsx`、`types/chat.ts`、全部后端代码。

---

## Task 1: 安装依赖

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: 安装 react-markdown（dependencies）和 @tailwindcss/typography（devDependencies）**

```bash
cd web
npm install react-markdown
npm install -D @tailwindcss/typography
```

`react-markdown` 是运行时依赖（浏览器需要）。`@tailwindcss/typography` 是构建时依赖（只在 Tailwind 编译 CSS 时使用），放 `devDependencies`，与现有 `tailwindcss` 归类一致。

- [ ] **Step 2: 验证构建无报错**

```bash
cd web
npm run build
```

Expected: 构建成功，无错误输出。

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "chore: add react-markdown and @tailwindcss/typography dependencies"
```

---

## Task 2: 配置 Tailwind Typography 插件

**Files:**
- Modify: `web/src/App.css:1-3`

- [ ] **Step 1: 在 App.css 中添加 @plugin 声明**

在现有 `@import` 语句之后添加一行：

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/geist";
@plugin "@tailwindcss/typography";
```

Tailwind CSS v4 通过 `@plugin` 指令加载插件（不同于 v3 的 `tailwind.config.js` plugins 数组）。

- [ ] **Step 2: 验证 dev server 启动无报错**

```bash
cd web
npx vite build 2>&1 | head -20
```

Expected: 构建成功。若出现插件加载错误，检查 `@tailwindcss/typography` 版本是否兼容 Tailwind v4。

- [ ] **Step 3: Commit**

```bash
git add web/src/App.css
git commit -m "chore: enable @tailwindcss/typography plugin for prose classes"
```

---

## Task 3: 编写 Markdown 渲染的失败测试

**Files:**
- Modify: `web/src/components/__tests__/MessageBubble.test.tsx`

- [ ] **Step 1: 在 MessageBubble.test.tsx 中新增 Markdown 渲染测试 describe 块**

在现有 `describe('MessageBubble', ...)` 闭合括号之后，追加以下代码：

```typescript
describe('MessageBubble — Markdown rendering', () => {
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
});
```

- [ ] **Step 2: 运行测试，确认新测试全部失败**

```bash
cd web
npx vitest run src/components/__tests__/MessageBubble.test.tsx
```

Expected: 原有 3 个测试 PASS，新增 6 个测试 FAIL。失败原因：`MessageBubble` 还在用 `<p>` 纯文本渲染 assistant 消息，不会产生 `<strong>`、`<em>`、`<li>` 等元素，也不会有 `prose` class。

- [ ] **Step 3: Commit 失败测试**

```bash
git add web/src/components/__tests__/MessageBubble.test.tsx
git commit -m "test: add failing tests for Markdown rendering in MessageBubble"
```

---

## Task 4: 实现 Markdown 渲染

**Files:**
- Modify: `web/src/components/MessageBubble.tsx`

- [ ] **Step 1: 修改 MessageBubble，assistant 消息使用 ReactMarkdown 渲染**

将 `web/src/components/MessageBubble.tsx` 的完整内容替换为：

```tsx
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
```

**关键实现说明：**

- `proseClasses` 提取为组件顶部常量，避免 JSX 内多行字符串的语法问题
- 注释放在三元表达式外部（`{/* ... */}` 在 `{isUser ? ... : ...}` 之前），避免 JSX 相邻元素编译错误
- `prose` 类放在包裹 `<div>` 上而非 `ReactMarkdown` 的 `className` prop——`react-markdown` 新版本已移除 `className` prop，用 wrapper `<div>` 兼容所有版本
- 各 prose modifier 的含义见 `proseClasses` 上方的注释

- [ ] **Step 2: 运行全部测试，确认全部通过**

```bash
cd web
npx vitest run src/components/__tests__/MessageBubble.test.tsx
```

Expected: 全部 9 个测试（原有 3 + 新增 6）PASS。

若出现失败：
- 如果 `react-markdown` 的 ESM 导入报错 → 检查 vitest.config.ts 是否正确 merge 了 vite config（当前配置已经 merge，应该没问题）
- 如果 `prose` class 检测失败 → 确认包裹 `ReactMarkdown` 的外层 `<div>` 应用了 `proseClasses` 常量
- 如果 `<strong>` / `<em>` 不存在 → 确认 `react-markdown` 被正确导入且用于 assistant 分支

- [ ] **Step 3: 运行完整测试套件确认无回归**

```bash
cd web
npm run test
```

Expected: 全部测试通过，包括 ChatWindow、ChatInput、MessageList、useConversation 等其他测试文件。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/MessageBubble.tsx
git commit -m "feat: render Markdown in assistant messages with react-markdown + prose"
```

---

## Task 5: 清理过时注释

**Files:**
- Modify: `web/src/components/__tests__/MessageBubble.test.tsx:1-4`

- [ ] **Step 1: 更新测试文件顶部过时注释**

将文件开头的注释从：

```typescript
/**
 * MessageBubble 单元测试：校验文案渲染与用户/助手气泡在布局类名上的差异。
 * Step 1 阶段组件尚未实现，运行测试应失败（找不到 ../MessageBubble）。
 */
```

替换为：

```typescript
/**
 * MessageBubble 单元测试：
 * - 基础：文案渲染与用户/助手气泡布局类名差异
 * - Markdown：助手消息的粗体、斜体、列表渲染；用户消息纯文本保持
 */
```

- [ ] **Step 2: 运行测试确认无破坏**

```bash
cd web
npm run test
```

Expected: 全部测试通过。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/__tests__/MessageBubble.test.tsx
git commit -m "docs: update MessageBubble test file comment to reflect Phase 2"
```

---

## Task 6: 视觉验收

- [ ] **Step 1: 启动后端和前端**

终端 1:
```bash
npm run dev:server
```

终端 2:
```bash
cd web && npm run dev
```

- [ ] **Step 2: 在浏览器中验证 Markdown 渲染效果**

打开 `http://localhost:5173`，发送以下测试消息（或任意触发 LLM 返回 Markdown 的消息）：

- 输入 "how to say 今天天气很好 in English" — 预期 assistant 回复中 **粗体标题**、*斜体单词*、列表项均正确渲染
- 检查 user 消息气泡是否仍为纯文本（输入 `**test**` 应显示为 `**test**` 而非粗体）
- 切换深色模式（如果浏览器支持），检查 `prose-invert` 是否正常

- [ ] **Step 3: 最终 commit（如果视觉验收中微调了 prose 类值）**

若 Step 2 中发现间距/颜色需要微调 prose modifier，修改 `MessageBubble.tsx` 中的 className 后：

```bash
cd web && npm run test
git add -A
git commit -m "style: fine-tune prose modifiers for chat bubble spacing"
```

若无需调整则跳过此步。
