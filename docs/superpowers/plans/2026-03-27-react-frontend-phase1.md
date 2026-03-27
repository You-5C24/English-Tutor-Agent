# React 前端 Phase 1 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 English Tutor Agent 构建一个 React Web 聊天界面，让用户通过浏览器与英语辅导 Agent 进行文字对话。

**Architecture:** 在仓库根目录新增 `web/` 前端项目（Vite + React + TypeScript），与后端各自独立的 package.json 和构建流程。前端通过 Vite proxy 将 `/api` 请求转发到后端 3000 端口。后端唯一改动是为路由添加 `/api` 前缀。

**Tech Stack:** Vite 6, React 19, TypeScript, Tailwind CSS 4, Shadcn UI (Button + ScrollArea), Vitest + React Testing Library

**注释约定（贯穿所有 Task）：** 在实现代码中，关键 React 概念处（如 `useState`、`useEffect`、`useRef`、`useCallback`、props 单向数据流等）添加简明中文注释，帮助理解。注释聚焦于 React 特有概念，不注释通用 TypeScript/JavaScript 语法。

---

## File Structure

### 后端修改

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `src/app.ts` | 添加 `/api` 路由前缀 |

### 前端新建

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `web/package.json` | 前端独立依赖管理 |
| Create | `web/index.html` | Vite 入口 HTML |
| Create | `web/tsconfig.json` | 前端 TS 配置 |
| Create | `web/tsconfig.app.json` | App 编译配置 |
| Create | `web/tsconfig.node.json` | Node 编译配置（Vite 配置文件用） |
| Create | `web/vite.config.ts` | Vite 构建 + Proxy + Tailwind 配置 |
| Create | `web/components.json` | Shadcn UI 配置（由 init 生成） |
| Create | `web/src/main.tsx` | React 入口 |
| Create | `web/src/App.tsx` | 根组件，整体布局 |
| Create | `web/src/App.css` | 全局样式 + Tailwind 导入 |
| Create | `web/src/types/chat.ts` | 共享类型定义 |
| Create | `web/src/api/chat.ts` | HTTP 请求封装 |
| Create | `web/src/hooks/useConversation.ts` | 对话状态管理 hook |
| Create | `web/src/components/MessageBubble.tsx` | 单条消息气泡 |
| Create | `web/src/components/MessageList.tsx` | 消息列表 + 自动滚动 |
| Create | `web/src/components/ChatInput.tsx` | 输入框 + 发送按钮 |
| Create | `web/src/components/ChatWindow.tsx` | 组合容器 + 错误提示 |
| Create | `web/src/components/ui/button.tsx` | Shadcn Button（由 CLI 生成） |
| Create | `web/src/components/ui/scroll-area.tsx` | Shadcn ScrollArea（由 CLI 生成） |

### 前端测试

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `web/vitest.config.ts` | Vitest 配置 |
| Create | `web/src/tests/setup.ts` | 测试全局 setup |
| Create | `web/src/api/__tests__/chat.test.ts` | API 层单元测试 |
| Create | `web/src/hooks/__tests__/useConversation.test.ts` | Hook 单元测试 |
| Create | `web/src/components/__tests__/MessageBubble.test.tsx` | 气泡组件测试 |
| Create | `web/src/components/__tests__/ChatInput.test.tsx` | 输入组件测试 |
| Create | `web/src/components/__tests__/MessageList.test.tsx` | 消息列表测试 |
| Create | `web/src/components/__tests__/ChatWindow.test.tsx` | 聊天窗口测试 |

---

## Task 1: 后端 — 添加 /api 路由前缀

**Files:**
- Modify: `src/app.ts` — 将 `app.register(chatRoutes)` 改为 `app.register(chatRoutes, { prefix: '/api' })`

- [ ] **Step 1: 修改路由注册**

在 `src/app.ts` 中，找到第 55 行：

```typescript
app.register(chatRoutes);
```

替换为：

```typescript
app.register(chatRoutes, { prefix: '/api' });
```

- [ ] **Step 2: 手动验证后端路由变更**

```bash
npm run dev:server
```

在另一个终端：

```bash
curl http://localhost:3000/api/health
```

Expected: `{"ok":true}`

```bash
curl http://localhost:3000/health
```

Expected: 404（旧路径不再可用）

验证完成后停止 server（Ctrl+C）。

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: add /api prefix to HTTP routes for frontend proxy"
```

---

## Task 2: 脚手架 — 创建 Vite + React + TypeScript 项目

**Files:**
- Create: `web/` 目录及 Vite 脚手架生成的所有文件

- [ ] **Step 1: 使用 Vite CLI 创建项目**

在项目根目录执行：

```bash
npm create vite@latest web -- --template react-ts
```

这会在 `web/` 下生成 React + TypeScript 项目骨架。

- [ ] **Step 2: 安装依赖**

```bash
cd web && npm install
```

- [ ] **Step 3: 清理脚手架样板文件**

删除不需要的样板内容：
- 删除 `web/src/assets/` 目录
- 清空 `web/src/App.css` 内容（稍后写入 Tailwind）
- 删除 `web/src/index.css`
- 删除 `web/public/vite.svg`

将 `web/src/App.tsx` 替换为最小占位内容：

```tsx
export default function App() {
  return <div>English Tutor</div>;
}
```

将 `web/src/main.tsx` 替换为：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: 配置 Vite Proxy**

将 `web/vite.config.ts` 替换为：

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 5: 验证前端能启动**

```bash
cd web && npm run dev
```

Expected: 浏览器打开 `http://localhost:5173` 能看到 "English Tutor" 文字。
验证后 Ctrl+C 停止。

- [ ] **Step 6: Commit**

```bash
cd .. && git add web/
git commit -m "feat: scaffold Vite + React + TypeScript frontend in web/"
```

---

## Task 3: 配置 Tailwind CSS 4

**Files:**
- Modify: `web/package.json` — 添加 tailwindcss 依赖
- Modify: `web/vite.config.ts` — 添加 Tailwind Vite 插件
- Modify: `web/src/App.css` — 添加 Tailwind 导入

- [ ] **Step 1: 安装 Tailwind CSS 4 + Vite 插件**

```bash
cd web && npm install tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: 在 Vite 配置中添加 Tailwind 插件**

修改 `web/vite.config.ts`：

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: 写入 Tailwind 全局样式**

将 `web/src/App.css` 写入：

```css
@import "tailwindcss";
```

- [ ] **Step 4: 验证 Tailwind 生效**

临时修改 `web/src/App.tsx`：

```tsx
export default function App() {
  return <div className="text-3xl font-bold text-blue-500 p-8">English Tutor</div>;
}
```

```bash
cd web && npm run dev
```

Expected: 看到蓝色大号粗体 "English Tutor"。验证后 Ctrl+C 停止。

还原 App.tsx 为：

```tsx
export default function App() {
  return <div>English Tutor</div>;
}
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/
git commit -m "feat: configure Tailwind CSS 4 with Vite plugin"
```

---

## Task 4: 安装并配置 Shadcn UI

**Files:**
- Create: `web/components.json` — Shadcn 配置（由 CLI 生成）
- Create: `web/src/components/ui/button.tsx` — Button 组件
- Create: `web/src/components/ui/scroll-area.tsx` — ScrollArea 组件
- Modify: `web/src/App.css` — Shadcn 会追加 CSS 变量

- [ ] **Step 1: 初始化 Shadcn UI**

```bash
cd web && npx shadcn@latest init -d
```

`-d` 使用默认配置。如果 CLI 仍有交互式提问，选择：
- Style: Default
- Base color: Neutral
- CSS variables: Yes

- [ ] **Step 2: 安装 Button 组件**

```bash
npx shadcn@latest add button
```

- [ ] **Step 3: 安装 ScrollArea 组件**

```bash
npx shadcn@latest add scroll-area
```

- [ ] **Step 4: 验证 Shadcn 组件可用**

临时修改 `web/src/App.tsx`：

```tsx
import { Button } from './components/ui/button';

export default function App() {
  return (
    <div className="p-8">
      <Button>Test Button</Button>
    </div>
  );
}
```

```bash
cd web && npm run dev
```

Expected: 看到一个样式正常的按钮。验证后 Ctrl+C 停止。

还原 App.tsx 为：

```tsx
export default function App() {
  return <div>English Tutor</div>;
}
```

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/
git commit -m "feat: set up Shadcn UI with Button and ScrollArea components"
```

---

## Task 5: 配置 Vitest + React Testing Library

**Files:**
- Modify: `web/package.json` — 添加测试依赖和 test 脚本
- Create: `web/vitest.config.ts` — Vitest 配置
- Create: `web/src/tests/setup.ts` — 测试全局 setup

- [ ] **Step 1: 安装测试依赖**

```bash
cd web && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event happy-dom
```

- [ ] **Step 2: 创建 Vitest 配置文件**

创建 `web/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/tests/setup.ts'],
    css: true,
  },
});
```

- [ ] **Step 3: 创建测试 setup 文件**

创建 `web/src/tests/setup.ts`：

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: 在 package.json 添加 test 脚本**

在 `web/package.json` 的 `scripts` 中添加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: 写一个冒烟测试验证环境**

创建 `web/src/tests/smoke.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('test environment', () => {
  it('renders a React component', () => {
    render(<div>hello</div>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 运行测试验证**

```bash
cd web && npm test
```

Expected: 1 test passed。

- [ ] **Step 7: Commit**

```bash
cd .. && git add web/
git commit -m "feat: set up Vitest + React Testing Library test infrastructure"
```

---

## Task 6: 定义 TypeScript 类型

**Files:**
- Create: `web/src/types/chat.ts`

- [ ] **Step 1: 创建类型定义文件**

创建 `web/src/types/chat.ts`：

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  scenario?: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  scenario: string;
}

export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}
```

- [ ] **Step 2: 验证类型文件无编译错误**

```bash
cd web && npx tsc --noEmit
```

Expected: 无错误输出。

- [ ] **Step 3: Commit**

```bash
cd .. && git add web/src/types/
git commit -m "feat: define chat TypeScript types"
```

---

## Task 7: 实现 API 层（TDD）

**Files:**
- Create: `web/src/api/chat.ts`
- Create: `web/src/api/__tests__/chat.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/api/__tests__/chat.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendChatMessage, checkHealth, ChatApiError } from '../chat';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('sendChatMessage', () => {
  it('sends request and returns response on success', async () => {
    const mockResponse = { reply: 'Hello!', sessionId: 'sid-1', scenario: 'greeting' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await sendChatMessage({ message: 'Hi' });

    expect(mockFetch).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hi' }),
    });
    expect(result).toEqual(mockResponse);
  });

  it('includes sessionId in request when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ reply: 'Hi', sessionId: 'sid-1', scenario: 'grammar' }),
    });

    await sendChatMessage({ message: 'Hi', sessionId: 'sid-1' });

    expect(mockFetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      body: JSON.stringify({ message: 'Hi', sessionId: 'sid-1' }),
    }));
  });

  it('throws ChatApiError on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Session not found', code: 'SESSION_NOT_FOUND', statusCode: 404 }),
    });

    await expect(sendChatMessage({ message: 'Hi', sessionId: 'bad-id' }))
      .rejects.toThrow(ChatApiError);

    try {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Session not found', code: 'SESSION_NOT_FOUND', statusCode: 404 }),
      });
      await sendChatMessage({ message: 'Hi', sessionId: 'bad-id' });
    } catch (err) {
      expect(err).toBeInstanceOf(ChatApiError);
      expect((err as ChatApiError).code).toBe('SESSION_NOT_FOUND');
      expect((err as ChatApiError).statusCode).toBe(404);
    }
  });

  it('throws ChatApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(sendChatMessage({ message: 'Hi' })).rejects.toThrow(TypeError);
  });
});

describe('checkHealth', () => {
  it('returns ok on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await checkHealth();
    expect(result).toEqual({ ok: true });
  });

  it('throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(checkHealth()).rejects.toThrow(ChatApiError);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/api/__tests__/chat.test.ts
```

Expected: FAIL — 模块 `../chat` 不存在。

- [ ] **Step 3: 实现 API 层**

创建 `web/src/api/chat.ts`：

```typescript
import type { ChatRequest, ChatResponse, ErrorResponse } from '../types/chat';

const API_BASE = '/api';

export class ChatApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

export async function sendChatMessage(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err: ErrorResponse = await res.json();
    throw new ChatApiError(err.error, err.code, err.statusCode);
  }

  return res.json();
}

export async function checkHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) {
    throw new ChatApiError('Health check failed', 'HEALTH_CHECK_FAILED', res.status);
  }
  return res.json();
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/api/__tests__/chat.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/api/
git commit -m "feat: implement chat API layer with fetch wrapper"
```

---

## Task 8: 实现 useConversation Hook（TDD）

**Files:**
- Create: `web/src/hooks/useConversation.ts`
- Create: `web/src/hooks/__tests__/useConversation.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/hooks/__tests__/useConversation.test.ts`：

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversation } from '../useConversation';
import * as chatApi from '../../api/chat';

vi.mock('../../api/chat');
const mockedSendChatMessage = vi.mocked(chatApi.sendChatMessage);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn()
      .mockReturnValueOnce('user-msg-1')
      .mockReturnValueOnce('assistant-msg-1')
      .mockReturnValueOnce('user-msg-2')
      .mockReturnValueOnce('assistant-msg-2'),
  });
});

describe('useConversation', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useConversation());

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sends a message and receives a reply', async () => {
    mockedSendChatMessage.mockResolvedValueOnce({
      reply: 'Hello! How can I help?',
      sessionId: 'sid-1',
      scenario: 'greeting',
    });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'Hi',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello! How can I help?',
      scenario: 'greeting',
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('passes sessionId on subsequent messages', async () => {
    mockedSendChatMessage
      .mockResolvedValueOnce({ reply: 'Hi', sessionId: 'sid-1', scenario: 'greeting' })
      .mockResolvedValueOnce({ reply: 'Sure', sessionId: 'sid-1', scenario: 'grammar' });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hello');
    });
    expect(mockedSendChatMessage).toHaveBeenCalledWith({ message: 'Hello', sessionId: undefined });

    await act(async () => {
      await result.current.sendMessage('Teach me grammar');
    });
    expect(mockedSendChatMessage).toHaveBeenCalledWith({ message: 'Teach me grammar', sessionId: 'sid-1' });
  });

  it('sets error on API failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Server error', 'LLM_ERROR', 500),
    );

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.messages).toHaveLength(1); // user message preserved
    expect(result.current.isLoading).toBe(false);
  });

  it('sets network error message on fetch failure', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.error).toBe('网络连接失败，请检查网络后重试');
  });

  it('clears error with clearError', async () => {
    mockedSendChatMessage.mockRejectedValueOnce(
      new chatApi.ChatApiError('Error', 'LLM_ERROR', 500),
    );

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hi');
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('ignores empty or whitespace-only messages', async () => {
    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(result.current.messages).toEqual([]);
    expect(mockedSendChatMessage).not.toHaveBeenCalled();
  });

  it('resets sessionId on SESSION_NOT_FOUND error', async () => {
    mockedSendChatMessage
      .mockResolvedValueOnce({ reply: 'Hi', sessionId: 'sid-1', scenario: 'greeting' })
      .mockRejectedValueOnce(new chatApi.ChatApiError('Session not found', 'SESSION_NOT_FOUND', 404));

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    await act(async () => {
      await result.current.sendMessage('Again');
    });

    expect(result.current.error).toBe('会话已过期，请重新发送消息开始新对话');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/hooks/__tests__/useConversation.test.ts
```

Expected: FAIL — 模块 `../useConversation` 不存在。

- [ ] **Step 3: 实现 useConversation hook**

创建 `web/src/hooks/useConversation.ts`：

```typescript
import { useState, useCallback } from 'react';
import type { Message } from '../types/chat';
import { sendChatMessage, ChatApiError } from '../api/chat';

export interface UseConversationReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
}

export function useConversation(): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendChatMessage({ message: trimmed, sessionId });

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
        scenario: response.scenario,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setSessionId(response.sessionId);
    } catch (err) {
      if (err instanceof ChatApiError) {
        if (err.code === 'SESSION_NOT_FOUND') {
          setError('会话已过期，请重新发送消息开始新对话');
          setSessionId(undefined);
        } else {
          setError(err.message);
        }
      } else {
        setError('网络连接失败，请检查网络后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sessionId]);

  const clearError = useCallback(() => setError(null), []);

  return { messages, isLoading, error, sendMessage, clearError };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/hooks/__tests__/useConversation.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/hooks/
git commit -m "feat: implement useConversation hook with session and error handling"
```

---

## Task 9: 实现 MessageBubble 组件（TDD）

**Files:**
- Create: `web/src/components/MessageBubble.tsx`
- Create: `web/src/components/__tests__/MessageBubble.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/__tests__/MessageBubble.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from '../MessageBubble';
import type { Message } from '../../types/chat';

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
  it('renders user message content', () => {
    render(<MessageBubble message={userMessage} />);
    expect(screen.getByText('Hello teacher')).toBeInTheDocument();
  });

  it('renders assistant message content', () => {
    render(<MessageBubble message={assistantMessage} />);
    expect(screen.getByText('Hello! How can I help you?')).toBeInTheDocument();
  });

  it('applies different alignment for user vs assistant', () => {
    const { container: userContainer } = render(<MessageBubble message={userMessage} />);
    const { container: assistantContainer } = render(<MessageBubble message={assistantMessage} />);

    const userWrapper = userContainer.firstElementChild as HTMLElement;
    const assistantWrapper = assistantContainer.firstElementChild as HTMLElement;

    expect(userWrapper.className).toContain('justify-end');
    expect(assistantWrapper.className).toContain('justify-start');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/components/__tests__/MessageBubble.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现 MessageBubble**

创建 `web/src/components/MessageBubble.tsx`：

```tsx
import type { Message } from '../types/chat';

interface MessageBubbleProps {
  message: Message;
}

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
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/components/__tests__/MessageBubble.test.tsx
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/components/MessageBubble.tsx web/src/components/__tests__/MessageBubble.test.tsx
git commit -m "feat: implement MessageBubble component with user/assistant styles"
```

---

## Task 10: 实现 ChatInput 组件（TDD）

**Files:**
- Create: `web/src/components/ChatInput.tsx`
- Create: `web/src/components/__tests__/ChatInput.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/__tests__/ChatInput.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatInput } from '../ChatInput';

describe('ChatInput', () => {
  it('renders textarea and send button', () => {
    render(<ChatInput isLoading={false} onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

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

  it('submits on Enter key (without Shift)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isLoading={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'Hello');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput isLoading={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText('输入消息...');
    await user.type(textarea, 'Hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables textarea and button when loading', () => {
    render(<ChatInput isLoading={true} onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('输入消息...')).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  it('disables send button when input is empty', () => {
    render(<ChatInput isLoading={false} onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });

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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/components/__tests__/ChatInput.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现 ChatInput**

创建 `web/src/components/ChatInput.tsx`：

```tsx
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from './ui/button';

interface ChatInputProps {
  isLoading: boolean;
  onSend: (text: string) => void;
}

export function ChatInput({ isLoading, onSend }: ChatInputProps) {
  const [input, setInput] = useState('');

  const doSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    doSend();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t">
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        disabled={isLoading}
        rows={1}
        className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <Button type="submit" disabled={isLoading || !input.trim()}>
        发送
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/components/__tests__/ChatInput.test.tsx
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/components/ChatInput.tsx web/src/components/__tests__/ChatInput.test.tsx
git commit -m "feat: implement ChatInput with textarea, Enter to send, Shift+Enter for newline"
```

---

## Task 11: 实现 MessageList 组件（TDD）

**Files:**
- Create: `web/src/components/MessageList.tsx`
- Create: `web/src/components/__tests__/MessageList.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/__tests__/MessageList.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageList } from '../MessageList';
import type { Message } from '../../types/chat';

const messages: Message[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
  { id: '2', role: 'assistant', content: 'Hi there!', timestamp: 2, scenario: 'greeting' },
];

describe('MessageList', () => {
  it('renders all messages', () => {
    render(<MessageList messages={messages} isLoading={false} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows loading indicator when isLoading is true', () => {
    render(<MessageList messages={messages} isLoading={true} />);
    expect(screen.getByText('正在思考...')).toBeInTheDocument();
  });

  it('does not show loading indicator when isLoading is false', () => {
    render(<MessageList messages={messages} isLoading={false} />);
    expect(screen.queryByText('正在思考...')).not.toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    render(<MessageList messages={[]} isLoading={false} />);
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/components/__tests__/MessageList.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现 MessageList**

创建 `web/src/components/MessageList.tsx`：

```tsx
import { useRef, useEffect } from 'react';
import type { Message } from '../types/chat';
import { MessageBubble } from './MessageBubble';
import { ScrollArea } from './ui/scroll-area';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  // useRef 创建一个不触发重渲染的 DOM 引用，用于滚动到底部
  const bottomRef = useRef<HTMLDivElement>(null);

  // useEffect 在 messages 变化后执行副作用：自动滚动到最新消息
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-4 py-2">
              <p className="text-sm text-muted-foreground">正在思考...</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/components/__tests__/MessageList.test.tsx
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/components/MessageList.tsx web/src/components/__tests__/MessageList.test.tsx
git commit -m "feat: implement MessageList with auto-scroll and loading indicator"
```

---

## Task 12: 实现 ChatWindow 组件（TDD）

**Files:**
- Create: `web/src/components/ChatWindow.tsx`
- Create: `web/src/components/__tests__/ChatWindow.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/__tests__/ChatWindow.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ChatWindow } from '../ChatWindow';
import type { Message } from '../../types/chat';

const messages: Message[] = [
  { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
  { id: '2', role: 'assistant', content: 'Hi!', timestamp: 2, scenario: 'greeting' },
];

describe('ChatWindow', () => {
  it('renders messages, input, and no error bar when error is null', () => {
    render(
      <ChatWindow
        messages={messages}
        isLoading={false}
        error={null}
        onSend={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi!')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument();
  });

  it('renders error bar when error is set', () => {
    render(
      <ChatWindow
        messages={[]}
        isLoading={false}
        error="Something went wrong"
        onSend={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

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
      />,
    );

    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/components/__tests__/ChatWindow.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现 ChatWindow**

创建 `web/src/components/ChatWindow.tsx`：

```tsx
import type { Message } from '../types/chat';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onDismissError: () => void;
}

export function ChatWindow({ messages, isLoading, error, onSend, onDismissError }: ChatWindowProps) {
  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="flex items-center justify-between bg-destructive/10 text-destructive px-4 py-2 text-sm">
          <span>{error}</span>
          <button onClick={onDismissError} className="ml-2 hover:opacity-70" aria-label="✕">
            ✕
          </button>
        </div>
      )}
      <MessageList messages={messages} isLoading={isLoading} />
      <ChatInput isLoading={isLoading} onSend={onSend} />
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/components/__tests__/ChatWindow.test.tsx
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/src/components/ChatWindow.tsx web/src/components/__tests__/ChatWindow.test.tsx
git commit -m "feat: implement ChatWindow container with error bar"
```

---

## Task 13: 组装 App.tsx + 全局样式

**Files:**
- Modify: `web/src/App.tsx` — 替换为完整根组件
- Modify: `web/src/App.css` — 确保 Tailwind 和全局样式就绪

- [ ] **Step 1: 写入最终 App.tsx**

将 `web/src/App.tsx` 替换为：

```tsx
import { useConversation } from './hooks/useConversation';
import { ChatWindow } from './components/ChatWindow';

export default function App() {
  // useConversation 集中管理对话状态：消息列表、加载态、错误、发送方法
  const { messages, isLoading, error, sendMessage, clearError } = useConversation();

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-center border-b px-4 py-3 shrink-0">
        <h1 className="text-lg font-semibold">🎓 English Tutor</h1>
      </header>
      <main className="flex-1 overflow-hidden">
        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          error={error}
          onSend={sendMessage}
          onDismissError={clearError}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 确认 App.css 包含 Tailwind 导入**

确保 `web/src/App.css` 顶部包含：

```css
@import "tailwindcss";
```

保留 Shadcn 在初始化时追加的 CSS 变量（如果有的话），不要删除。

- [ ] **Step 3: 运行全部测试**

```bash
cd web && npm test
```

Expected: 所有测试 PASS。

- [ ] **Step 4: Commit**

```bash
cd .. && git add web/src/App.tsx web/src/App.css
git commit -m "feat: assemble App root component with ChatWindow"
```

---

## Task 14: 全链路集成验证

**Files:** 无新文件，验证流程

- [ ] **Step 1: 运行全部前端测试**

```bash
cd web && npm test
```

Expected: 所有测试 PASS，无失败。

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd web && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: 启动后端**

```bash
cd .. && npm run dev:server
```

等待 `Server listening at http://0.0.0.0:3000` 输出。

- [ ] **Step 4: 启动前端（另一个终端）**

```bash
cd web && npm run dev
```

等待 Vite 就绪。

- [ ] **Step 5: 浏览器手动验证**

打开 `http://localhost:5173`，依次验证：

1. **页面加载** — 看到 "🎓 English Tutor" 标题和输入框
2. **发送消息** — 输入文字点击发送，user 消息立刻出现（乐观更新）
3. **接收回复** — 等待后看到 assistant 回复出现
4. **Loading 状态** — 发送期间显示 "正在思考..."，输入框和按钮禁用
5. **自动滚动** — 多条消息后列表自动滚动到底部
6. **Enter 发送** — 按 Enter 能发送消息
7. **Shift+Enter 换行** — 按 Shift+Enter 在输入框内换行

- [ ] **Step 6: 删除冒烟测试文件**

在项目根目录执行：

```bash
rm web/src/tests/smoke.test.tsx
```

若当前在 `web/` 目录下，先 `cd ..` 回到项目根目录再执行上述命令。

- [ ] **Step 7: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete React frontend Phase 1 MVP integration"
```
