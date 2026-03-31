# Markdown 渲染设计 — Phase 2

> English Tutor Agent 前端 Phase 2 设计文档
> 日期：2026-03-30
> 前置：[Phase 1 React 前端架构设计](./2026-03-27-react-frontend-architecture-design.md)

## 1. 背景与目标

Phase 1 已完成 React 前端 MVP，用户可通过浏览器与英语辅导 Agent 进行文字对话。当前 `MessageBubble` 组件用 `<p className="whitespace-pre-wrap">` 纯文本渲染 `message.content`，LLM 输出中的 Markdown 标记（`**粗体**`、`*斜体*`、列表等）以原始文本显示，可读性差。

**Phase 2 目标：** 将 assistant 消息中的 Markdown 渲染为格式化的富文本，提升对话可读性。

**非目标（Phase 2 不做）：**
- User 消息的 Markdown 渲染（保持纯文本，避免用户输入被意外解析）
- GFM 扩展（表格、任务列表、删除线）— 当前 LLM 输出中未出现
- 代码块语法高亮 — 英语辅导场景不涉及编程
- 自定义 Markdown 组件（如可播放音频卡片）— 留给 Phase 5

## 2. LLM 输出特征分析

基于实际使用观察，英语辅导 Agent 的回复主要使用以下 Markdown 元素：

| Markdown 元素 | 用途 | 出现频率 |
|---------------|------|----------|
| `**粗体**` | 分类标题（如 "Basic & Clear:"、"Pro tip:"） | 高 |
| `*斜体*` | 高亮英文单词（如 *lovely*、*gorgeous*） | 高 |
| `- ` 无序列表 | 列举例句 | 高 |
| `1. ` 有序列表 | 编号例句 | 中 |
| 段落与换行 | 结构化内容分隔 | 高 |
| 引号包裹的文本 | 示例句子（非 Markdown blockquote，是 `"..."` 文本引号） | 中 |

**未观察到的元素：** 代码块、表格、图片、链接、标题（`#`）、blockquote（`>`）。

## 3. 技术方案

### 3.1 方案选型

评估了三个方案，选定方案 A：

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. `react-markdown` + Tailwind Typography | Markdown → React 组件树，`prose` 类排版 | 最小改动，防 XSS，组件化扩展能力强 | 依赖体积略大于手动解析 | **选定** |
| B. `react-markdown` + `remark-gfm` + 语法高亮 | 方案 A + GFM 扩展 + 代码高亮 | 覆盖全部 Markdown 场景 | 引入不需要的依赖，违反 YAGNI | 不选 |
| C. `marked` + `dangerouslySetInnerHTML` | 解析为 HTML 字符串，注入 DOM | 包体最小 | 需手动防 XSS，失去 React 组件化能力，扩展困难 | 不选 |

### 3.2 新增依赖

| 包 | 版本 | 用途 |
|---|------|------|
| `react-markdown` | latest | 将 Markdown 字符串渲染为 React 组件树 |
| `@tailwindcss/typography` | latest | 提供 `prose` 排版类，为渲染出的 HTML 元素提供美观的默认样式 |

### 3.3 安全性

`react-markdown` 将 Markdown 解析为 React 元素（`React.createElement`），而非生成 HTML 字符串。不使用 `dangerouslySetInnerHTML`，天然免疫 XSS 攻击。不需要额外引入 `DOMPurify` 等净化库。

## 4. 改动范围

### 4.1 改动文件清单

| 文件 | 改动内容 |
|------|----------|
| `web/package.json` | 新增 `react-markdown`、`@tailwindcss/typography` 依赖 |
| `web/src/App.css` | 添加 `@plugin "@tailwindcss/typography"` |
| `web/src/components/MessageBubble.tsx` | assistant 消息使用 `ReactMarkdown` + `prose` 渲染 |
| `web/src/components/__tests__/MessageBubble.test.tsx` | 新增 Markdown 渲染相关测试用例 |

### 4.2 不改动的部分

- `useConversation` hook — 数据流不变
- `api/chat.ts` — API 层不变
- `ChatWindow`、`MessageList`、`ChatInput` — 不涉及
- `types/chat.ts` — 类型定义不变
- 后端全部代码 — 不涉及

## 5. 组件架构

### 5.1 组件树（不变）

```
App
└── ChatWindow
    ├── MessageList
    │   └── MessageBubble × N   ← 仅内部渲染逻辑变化
    └── ChatInput
```

### 5.2 MessageBubble 渲染逻辑

```
MessageBubble({ message })
│
├── role === 'user'
│   └── <p className="whitespace-pre-wrap">{content}</p>     ← 保持 Phase 1 不变
│
└── role === 'assistant'
    └── <ReactMarkdown className="prose prose-sm ...">{content}</ReactMarkdown>
```

**不抽取 `MarkdownContent` 子组件的理由：** 当前只有 `MessageBubble` 一处使用 Markdown 渲染，无复用场景。增加文件和 import 只带来间接性而不带来价值。如果日后 Phase 5/6 有其他地方需要 Markdown 渲染，提取成本极低（把几行 JSX 移到新文件）。

## 6. 样式方案

### 6.1 Tailwind Typography 集成

在 `App.css` 中添加插件声明（Tailwind CSS v4 语法）：

```css
@plugin "@tailwindcss/typography";
```

### 6.2 prose 类定制

`prose` 默认样式面向文章排版，在聊天气泡场景中需要调整：

| 问题 | 解决方案 |
|------|----------|
| 默认字号偏大 | `prose-sm` 匹配现有 `text-sm` |
| 默认 `max-width` 限制 | `max-w-none` 取消 |
| 深色模式文字颜色 | `dark:prose-invert` |
| 首尾元素多余 margin | `[&>*:first-child]:mt-0 [&>*:last-child]:mb-0` |
| 段落/列表间距过大 | `prose-p:my-1 prose-ul:my-1 prose-ol:my-1` 等缩紧 |

具体的 prose modifier 值在实现时根据视觉效果微调，本设计规定方向，不锁死具体数值。

### 6.3 用户气泡样式

User 消息保持 `bg-primary text-primary-foreground` + 纯文本渲染，不变。

## 7. 扩展预留

Phase 2 的架构选型天然支持后续 Phase 的扩展，无需预埋任何代码：

| 后续 Phase | 扩展方式 | 对 Phase 2 代码的改动 |
|-----------|----------|----------------------|
| Phase 4 (Streaming) | `content` 字符串实时更新，`ReactMarkdown` 自动重渲染 | 无 |
| Phase 5 (TTS) | 通过 `components` prop 将段落替换为带播放按钮的组件 | 给 `ReactMarkdown` 加 `components` prop |
| GFM 表格 | 添加 `remark-gfm` 插件 | 给 `ReactMarkdown` 加 `remarkPlugins` |
| 代码高亮 | 添加 `rehype-highlight` 插件 | 给 `ReactMarkdown` 加 `rehypePlugins` |

## 8. 测试策略

改动集中在 `MessageBubble`，测试也集中于此。

### 8.1 新增测试用例

| 测试场景 | 输入 | 断言 |
|----------|------|------|
| assistant 粗体渲染 | `role: 'assistant'`, `content: '**Bold**'` | DOM 中存在 `<strong>Bold</strong>` |
| assistant 斜体渲染 | `role: 'assistant'`, `content: '*italic*'` | DOM 中存在 `<em>italic</em>` |
| assistant 无序列表 | `role: 'assistant'`, `content: '- a\n- b'` | DOM 中存在 `<ul>` 和 2 个 `<li>` |
| assistant 有序列表 | `role: 'assistant'`, `content: '1. a\n2. b'` | DOM 中存在 `<ol>` 和 2 个 `<li>` |
| user 消息不渲染 Markdown | `role: 'user'`, `content: '**not bold**'` | DOM 中无 `<strong>`，文本内容为 `**not bold**` |
| prose 类存在性 | `role: 'assistant'` | 容器元素上有 `prose` class |

### 8.2 不测的

- `react-markdown` 内部的 Markdown 解析正确性（库的责任）
- 具体的像素级 CSS 样式（Tailwind prose 管理，非单测范围）

## 9. 代码注释约定

延续 Phase 1 约定：关键 React 概念处添加简明中文注释。Phase 2 新增注释重点：
- `ReactMarkdown` 组件的 `className` 中各 prose modifier 的用途
- user / assistant 条件分支的设计意图

## 10. 演进路线（更新）

```
Phase 1（MVP 文字聊天）✅ 已完成
  ├── Phase 2（Markdown 渲染）← 本次实现
  ├── Phase 3（对话记忆持久化）
  ├── 后端：LangChain 改造
  └── Phase 4（Streaming 响应）
        └── Phase 5（TTS 语音）
              └── Phase 6（数字人）
```

Phase 2 与 Phase 3 互不依赖，完成 Phase 2 后可按任意顺序继续。
