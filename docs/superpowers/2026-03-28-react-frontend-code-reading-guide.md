# React 前端代码阅读指南（Phase 1）

> 配合 [Phase 1 实施计划](./plans/2026-03-27-react-frontend-phase1.md) 与 [架构设计](./specs/2026-03-27-react-frontend-architecture-design.md) 使用。  
> 建议按下列顺序阅读 `web/src` 下的源码，并尝试书面回答每节后的**核心问题**以自检。

---

## 阅读顺序总览

| 序号 | 路径 | 主题 |
|------|------|------|
| 1 | `web/src/types/chat.ts` | 共享类型 |
| 2 | `web/src/api/chat.ts`（+ `web/src/api/__tests__/chat.test.ts`） | HTTP 封装 |
| 3 | `web/vite.config.ts`（`server.proxy`） | 开发代理 |
| 4 | `web/src/hooks/useConversation.ts`（+ `__tests__/useConversation.test.ts`） | 对话状态 |
| 5 | `web/src/components/MessageBubble.tsx` | 单条消息 UI |
| 6 | `web/src/components/ChatInput.tsx` | 输入与发送 |
| 7 | `web/src/components/MessageList.tsx` | 列表与滚动 |
| 8 | `web/src/components/ChatWindow.tsx` | 容器与错误条 |
| 9 | `web/src/App.tsx` | 根布局与接线 |
| 10 | `web/src/tests/setup.ts` | 测试环境（可选） |

---

## 1. `web/src/types/chat.ts`

**关键点：** `Message`、`ChatRequest`、`ChatResponse`、`ErrorResponse` 分别描述组件之间、前后端之间的数据结构。

**核心问题（请自答）：**

1. 一条「用户消息」和「助手消息」在类型上如何区分？
2. `sessionId` 出现在哪些类型里？为什么请求里是可选的？

---

## 2. `web/src/api/chat.ts`

可对照：`web/src/api/__tests__/chat.test.ts`。

**关键点：** `API_BASE`、`sendChatMessage`、`checkHealth`、`ChatApiError`；成功解析 JSON；HTTP 错误时从响应体构造 `ChatApiError`。

**核心问题（请自答）：**

1. 前端实际请求的聊天 URL 路径是什么？（相对路径）
2. HTTP 非 2xx 时，错误信息从响应体的哪些字段来？最终用什么类型表示？
3. 网络层 `fetch` 直接抛错时，本文件会不会把它包装成 `ChatApiError`？

---

## 3. `web/vite.config.ts`

只读 **`server.proxy`** 相关配置即可。

**关键点：** 开发时浏览器访问 `/api` 时由 Vite 转发到后端。

**核心问题（请自答）：**

1. 为什么前端代码里写 `/api/...` 在开发环境也能打到本机后端？
2. 若后端改端口，至少要改哪一处配置？

---

## 4. `web/src/hooks/useConversation.ts`

可对照：`web/src/hooks/__tests__/useConversation.test.ts`。

**关键点：** `messages`、`isLoading`、`error`、内部 `sessionId`；`sendMessage` 的流程（先用户消息、再请求、再助手消息或错误）；`clearError`。

**核心问题（请自答）：**

1. 「乐观更新」在本 hook 里具体是哪一段逻辑体现的？
2. 第二次发消息时，`sendChatMessage` 的请求体与第一次相比多了什么？依据是什么？
3. `SESSION_NOT_FOUND` 时，除了改 `error`，还对什么状态做了重置？为什么？

---

## 5. `web/src/components/MessageBubble.tsx`

**关键点：** 用 `message.role` 区分左右布局与样式；纯展示组件，不持有会话状态。

**核心问题（请自答）：**

1. 用户气泡与助手气泡在布局（左/右）上分别对应什么样式意图？
2. 若要在气泡里展示 `scenario`，应主要改本组件还是改 `useConversation`？

---

## 6. `web/src/components/ChatInput.tsx`

**关键点：** 输入字符串由本组件 `useState` 管理；通过 `onSend` 向父组件提交 trim 后的文本；Enter / Shift+Enter 行为；发送按钮与输入框的布局（当前实现为同一圆角容器内）。

**核心问题（请自答）：**

1. 为什么输入草稿不放在 `useConversation` 里，而放在 `ChatInput` 内部？
2. 单独按 Enter 与 Shift+Enter 在行为上差在哪里？对应哪段事件逻辑？

---

## 7. `web/src/components/MessageList.tsx`

**关键点：** `messages.map` → `MessageBubble`；`isLoading` 时展示「正在思考...」；`bottomRef` + `useEffect` 驱动滚动到底。

**核心问题（请自答）：**

1. 列表依赖的 props 是哪两个？哪个会驱动「滚到底」？
2. 加载指示条算不算一条 `Message`？为什么？

---

## 8. `web/src/components/ChatWindow.tsx`

**关键点：** `error` 存在时渲染顶栏与关闭按钮，关闭调用 `onDismissError`；下方组合 `MessageList` 与 `ChatInput`。

**核心问题（请自答）：**

1. `error` 为 `null` 时，错误条对应的 DOM 会不会出现？用哪种条件渲染？
2. `onDismissError` 在 `App` 里通常对应 hook 里的哪个函数？

---

## 9. `web/src/App.tsx`

**关键点：** 唯一调用 `useConversation` 的位置；将 `messages`、`isLoading`、`error`、`sendMessage`、`clearError` 传入 `ChatWindow`；整页 `header` + `main` 布局。

**核心问题（请自答）：**

1. 从数据流角度，`App` 里的「状态」实际定义在哪里？
2. `main` 使用 `flex-1 overflow-hidden` 的主要意图是什么？（结合内部有可滚动消息区）

---

## 10. `web/src/tests/setup.ts`（可选）

**关键点：** `@testing-library/jest-dom`；`afterEach(cleanup)`；`Element#getAnimations` polyfill 与 happy-dom / Base UI ScrollArea 的兼容性。

**核心问题（请自答）：**

1. `afterEach(cleanup)` 主要解决测试中的什么问题？
2. 若移除 `getAnimations` polyfill，哪类 UI 的测试更容易在 Vitest 中出现未处理异常？

---

## 使用建议

- **自检标准：** 能不打开文件，口头或书面答出每节 2～3 个问题，即算该层基本掌握。
- **卡住时：** 优先阅读同目录下的 `__tests__` 文件，测试即「可执行规格」。
- **与文档对照：** 数据流与组件职责以 [架构设计 §4–§5](./specs/2026-03-27-react-frontend-architecture-design.md) 为准；实现任务边界以 [Phase 1 计划](./plans/2026-03-27-react-frontend-phase1.md) 为准。

---

*文档生成日期：2026-03-28*
