# React 前端架构设计 — Phase 1 MVP

> English Tutor Agent 前端接入设计文档
> 日期：2026-03-27

## 1. 背景与目标

项目当前是一个纯后端 Node/TypeScript 英语辅导 Agent，基于 Fastify 提供 `POST /chat` 和 `GET /health` 两个 HTTP 接口，使用 Moonshot LLM 做对话生成，可选 ChromaDB 做 RAG。没有前端界面。

**Phase 1 目标：** 构建一个 React 前端 Web 界面，让用户通过浏览器与英语辅导 Agent 进行文字对话。

**长期目标：** 前端将逐步演进为数字人（TTS + 虚拟形象），Phase 1 的架构设计需要为此预留扩展空间。

**非目标（Phase 1 不做）：** 消息持久化、Markdown 渲染、流式响应、TTS、数字人。

## 2. 项目结构

采用「根目录并存」方案：在当前仓库根目录下新增 `web/` 文件夹放置 React 前端项目，后端代码保持原位不动。

```
English-Tutor-Agent/
├── src/                     # 后端代码（保持不动）
├── package.json             # 后端依赖
├── tsconfig.json            # 后端 TS 配置
└── web/                     # 新增：前端项目
    ├── index.html
    ├── package.json         # 前端独立依赖
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── components.json      # Shadcn UI 配置
    └── src/
        ├── main.tsx         # 入口，挂载 React 根组件
        ├── App.tsx          # 根组件，整体布局
        ├── App.css          # 全局样式 + Tailwind directives
        ├── api/
        │   └── chat.ts      # HTTP 请求封装
        ├── hooks/
        │   └── useConversation.ts  # 对话状态管理
        ├── components/
        │   ├── ui/          # Shadcn 生成的基础组件
        │   ├── ChatWindow.tsx
        │   ├── MessageList.tsx
        │   ├── MessageBubble.tsx
        │   └── ChatInput.tsx
        └── types/
            └── chat.ts      # 类型定义
```

**选择依据：**
- 后端零改动即可启动开发（路由前缀除外，见第 7 节）
- 两个项目各自独立的 `package.json`、构建流程和 TS 配置，不互相干扰
- 日后可无损升级为 monorepo 或独立仓库

## 3. 技术栈

| 层 | 选择 | 理由 |
|---|------|------|
| 构建工具 | Vite 6 | 极速 HMR，React 生态标配 |
| 框架 | React 19 + TypeScript | 学习目标 |
| 样式 | Tailwind CSS 4 | 用户已有经验，与 Shadcn 天然搭配 |
| 基础组件 | Shadcn UI（按需） | 源码在项目里，可读可改，不过度封装 |
| HTTP | 原生 fetch 封装 | 聊天场景够用，不引入 axios |
| 状态管理 | React 内置 useState | 单页面无需外部状态库 |
| 路由 | 暂不引入 | MVP 只有一个页面 |

**Shadcn UI 按需引入的组件：** Button、Input（或 Textarea）、ScrollArea。其余自己用 React + Tailwind 手写。

## 4. 组件架构

### 4.1 组件树

```
App
└── ChatWindow
    ├── MessageList
    │   └── MessageBubble × N
    └── ChatInput
```

### 4.2 组件职责

| 组件 | 职责 | Props（输入） | 回调（输出） |
|------|------|--------------|-------------|
| `App` | 持有 `useConversation` hook，页面整体布局 | — | — |
| `ChatWindow` | 组合 MessageList + ChatInput + 错误提示条，纯布局容器 | `messages`, `isLoading`, `error`, `onSend`, `onDismissError` | — |
| `MessageList` | 渲染消息列表，新消息自动滚动到底部 | `messages`, `isLoading` | — |
| `MessageBubble` | 渲染单条消息气泡，区分 user/assistant 样式 | `message: Message` | — |
| `ChatInput` | 输入框 + 发送按钮，管理本地输入文本状态 | `isLoading`（loading 时禁用发送） | `onSend(text: string)` |

### 4.3 设计原则

- **单向数据流：** 状态只在 `useConversation` 中修改，通过 props 逐层向下传递。组件不直接修改消息列表。
- **ChatInput 自管输入状态：** 输入框文字用组件内部 `useState` 管理，发送时通过 `onSend` 回调传出。避免每次按键触发整棵组件树重渲染。
- **MessageList 自动滚动：** 用 `useRef` 获取滚动容器 DOM 引用，`messages` 变化时 `scrollTo` 到底部。
- **乐观更新：** 用户消息发出后立刻显示（不等后端确认），请求失败时显示错误提示。

## 5. 数据流

### 5.1 单次对话时序

```
用户输入文本 → ChatInput.onSend(text)
  → App 调用 useConversation.sendMessage(text)
    → 1. 生成 user Message，追加到 messages[]
    → 2. isLoading = true
    → 3. 调用 api/chat.ts → POST /api/chat { message, sessionId? }
    → 4. 收到响应 → 生成 assistant Message，追加到 messages[]
    → 5. 保存 sessionId（首次对话由后端返回）
    → 6. isLoading = false
  → MessageList 重新渲染，显示新消息
  → MessageList 自动滚动到底部
```

### 5.2 错误处理流程

```
请求失败（网络错误 / 后端 5xx / 会话过期 404）
  → error 状态设为错误描述文本
  → ChatWindow 渲染错误提示条
  → 用户可点击关闭错误提示（clearError）
  → 用户消息保留在列表中，用户可在输入框重新输入发送（Phase 1 不提供「重试」按钮）
```

## 6. 核心接口定义

### 6.1 类型

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  scenario?: string;
}

interface ChatRequest {
  message: string;
  sessionId?: string;
}

interface ChatResponse {
  reply: string;
  sessionId: string;
  scenario: string;
}

interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}
```

### 6.2 API 层

```typescript
// api/chat.ts
async function sendChatMessage(req: ChatRequest): Promise<ChatResponse>;
async function checkHealth(): Promise<{ ok: boolean }>;
```

封装 `fetch` 调用，统一处理 HTTP 错误码（400/404/500）转换为可读的错误信息。日后加 streaming 时在此层新增 `streamChatMessage()` 函数，上层 hook 无感知。

### 6.3 useConversation hook

```typescript
interface UseConversationReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearError: () => void;
}

function useConversation(): UseConversationReturn;
```

hook 内部持有 `sessionId`（Phase 1 不暴露，Phase 2 暴露给外部做持久化）。命名为 `useConversation` 而非 `useChat`，因为长期目标是数字人——对话引擎不只服务文字聊天。

**扩展预留（Phase 1 不实现，仅预留接口空间）：**

- `Message.audioUrl?: string` — Phase 5 TTS 音频地址
- `Message.emotion?: string` — Phase 6 数字人表情标签
- `sessionId` 暴露 + `resetSession()` — Phase 3 对话记忆持久化
- `streamChatMessage()` — Phase 4 流式响应

## 7. 后端改动

Phase 1 仅一处改动：

### 7.1 路由前缀

在 `src/app.ts` 注册路由时加 `/api` 前缀：

```typescript
app.register(chatRoutes, { prefix: '/api' });
```

改动后：
- `POST /chat` → `POST /api/chat`
- `GET /health` → `GET /api/health`

**理由：**
- Vite proxy 可用一条规则 `/api → backend` 转发所有请求
- 日后前端静态文件托管时 `/api` 和 `/` 路由不冲突
- CLI 入口 `src/index.ts` 不受影响（它直接调用 `chat()` 函数，不走 HTTP）

**`routes/chat.ts` 不需要改动**，Fastify 的 `prefix` 选项自动在外部加前缀。

### 7.2 不改动的部分

- `chat-service.ts` — 核心逻辑完全不动
- `session-manager.ts` — 保持内存 Map 方案
- `classifier.ts`、`prompts/`、`rag/`、`tools/` — 全部不动
- `server.ts` — 启动逻辑不变
- 请求/响应 schema — 不变

## 8. 开发联调

### 8.1 Vite Proxy 配置

```typescript
// web/vite.config.ts
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

### 8.2 开发流程

1. 终端 1：`npm run dev:server` — 后端运行在 3000 端口
2. 终端 2：`cd web && npm run dev` — 前端运行在 5173 端口
3. 浏览器打开 `http://localhost:5173`
4. 前端请求 `/api/chat`，Vite 自动转发到 `http://localhost:3000/api/chat`

### 8.3 CORS

开发阶段通过 Vite proxy 转发，前后端同源，不存在跨域问题。后端现有的 CORS 配置（`origin: true`）作为兜底，不需要改。

## 9. 代码注释约定

在实现代码中，关键 React 概念处添加简明中文注释，帮助理解。注释聚焦于 React 特有概念，不注释通用 TypeScript/JavaScript 语法。

## 10. 演进路线

```
Phase 1（MVP 文字聊天）← 本次实现
  ├── Phase 2（Markdown 渲染）— 独立，可随时实施
  ├── Phase 3（对话记忆持久化）— 数字人记住用户，而非多会话切换
  ├── 后端：LangChain 改造（LLM 编排 / 分类 / 工具循环等）— 建议 Phase 4 之前完成
  └── Phase 4（Streaming 响应）
        └── Phase 5（TTS 语音）
              └── Phase 6（数字人）
```

Phase 2、3 互不依赖，完成 Phase 1 后可按任意顺序实施。推荐整体顺序：**Phase 2 → Phase 3 → LangChain 改造 → Phase 4**（LangChain 与 P2/P3 在时间上可部分并行，但宜避免与持久化首版大改同周合并以降低回归定位成本）。Phase 4 → 5 → 6 为强依赖链。

本设计文档覆盖 Phase 1 范围。后续 Phase 在各自启动时编写独立设计文档。
