# LangGraph 架构改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 编排层从手工代码改造为 LangGraph StateGraph，标准化抽象并为 Streaming 铺路。

**Architecture:** 分 5 个迁移阶段（Phase 0-4）递进改造。Phase 0 替换底层原语（ChatOpenAI、StructuredTool），Phase 1-3 逐步构建 StateGraph 图，Phase 4 验证 Streaming 能力。每个阶段独立可交付，系统始终保持可用。

**Tech Stack:** @langchain/core, @langchain/openai, @langchain/langgraph, zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-07-langgraph-migration-design.md`

---

## File Map

| 文件 | 阶段 | 操作 | 职责 |
|------|------|------|------|
| `package.json` | P0 | Modify | 新增 @langchain/core, @langchain/openai, zod |
| `src/llm/model.ts` | P0 | Create | ChatOpenAI 实例（Moonshot 兼容） |
| `src/llm/model-helpers.ts` | P0 | Create | OpenAI ↔ LangChain 消息格式转换辅助函数 |
| `src/tools/dictionary.ts` | P0 | Rewrite | ChatCompletionTool → StructuredTool（zod schema） |
| `src/classifier.ts` | P0 | Modify | client.chat.completions.create → chatModel.invoke |
| `src/services/chat-service.ts` | P0 | Modify | 调用层适配 LangChain 类型（流程不变） |
| `src/client.ts` | P0 | Delete (后续) | 被 src/llm/model.ts 替代 |
| `package.json` | P1 | Modify | 新增 @langchain/langgraph |
| `src/graph/state.ts` | P1 | Create | TutorState Annotation 定义 |
| `src/graph/adapters.ts` | P1 | Create | BaseMessage ↔ ChatCompletionMessageParam 转换 |
| `src/graph/nodes/classify.ts` | P1 | Create | 分类节点 |
| `src/graph/nodes/compress.ts` | P1 | Create | 压缩节点 |
| `src/graph/nodes/build-prompt.ts` | P1 | Create | Prompt 组装 + RAG 注入节点 |
| `src/graph/nodes/call-llm.ts` | P1 | Create | LLM 调用节点（含内部工具循环） |
| `src/graph/nodes/respond.ts` | P1 | Create | 响应提取节点 |
| `src/graph/index.ts` | P1 | Create | 图组装 + compile |
| `src/services/chat-service.ts` | P1 | Rewrite | 简化为 graph.invoke() 薄包装 |
| `src/graph/index.ts` | P2 | Modify | 添加并行 fan-out + 条件边 |
| `src/graph/nodes/call-llm.ts` | P3 | Modify | 移除内部循环，单次调用 |
| `src/graph/nodes/execute-tools.ts` | P3 | Create | 独立工具执行节点 |
| `src/graph/state.ts` | P3 | Modify | 新增 toolIterations 字段 |
| `src/graph/index.ts` | P3 | Modify | 添加 callLLM ↔ executeTools 循环 |
| `src/graph/verify-streaming.ts` | P4 | Create | Streaming 技术验证脚本 |

**不动的文件（全程）：** `src/db/*`、`src/services/session-manager.ts`、`src/types/session.ts`、`src/prompts/*`（内容）、`src/rag/*`、`src/routes/chat.ts`（P0 不动，P1 微调调用方式）、`web/`（全部）、`src/config.ts`、`src/app.ts`、`src/server.ts`（P0-P1 微调 import）。

---

# ═══════════════════════════════════════════════════════
# 迁移 Phase 0：LangChain 原语替换（不动编排）
# ═══════════════════════════════════════════════════════

> **学习目标：** ChatOpenAI、BaseMessage 体系、StructuredTool、.invoke() vs .stream()
>
> **完成标准：** 现有功能完全不变，底层调用从 OpenAI SDK 换为 LangChain 类

---

## Task 0.1: 安装 LangChain 基础依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/5c24/Documents/worksapce/English-Tutor-Agent
npm install @langchain/core @langchain/openai zod
```

- [ ] **Step 2: 验证安装成功**

```bash
npm ls @langchain/core @langchain/openai zod
```

Expected: 三个包均显示版本号，无 `MISSING` 或 `ERR`。

- [ ] **Step 3: 确认现有测试不受影响**

```bash
npm test
```

Expected: 所有现有测试通过（session-repo、message-repo、session-manager）。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @langchain/core, @langchain/openai, zod dependencies"
```

---

## Task 0.2: 创建 ChatOpenAI 模型封装

**Files:**
- Create: `src/llm/model.ts`

- [ ] **Step 1: 创建 `src/llm/model.ts`**

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { CHAT_MODEL } from '../config.js';

/**
 * 主对话模型 — 通过 OpenAI 兼容接口连接 Moonshot。
 * ChatOpenAI 的 configuration.baseURL 让它指向 Moonshot 而非 OpenAI。
 * 所有需要 LLM 的地方（分类、主对话、摘要）复用这一个实例。
 */
export const chatModel = new ChatOpenAI({
  configuration: {
    baseURL: 'https://api.moonshot.cn/v1',
  },
  apiKey: process.env.MOONSHOT_API_KEY,
  model: CHAT_MODEL,
});

/**
 * 摘要专用模型配置 — 关闭 Moonshot 的思考模式以节省 token。
 * 通过 .bind() 传递 Moonshot 扩展参数。
 */
export const summaryModel = chatModel.bind({
  max_completion_tokens: 150,
});
```

- [ ] **Step 2: 创建验证脚本确认 Moonshot 连通性**

创建 `src/llm/verify-moonshot.ts`（临时脚本，验证后可删除）：

```typescript
import { chatModel } from './model.js';
import { HumanMessage } from '@langchain/core/messages';

async function verify() {
  console.log('Testing ChatOpenAI → Moonshot connection...');
  const response = await chatModel.invoke([
    new HumanMessage('Say "hello" in one word.'),
  ]);
  console.log('Response type:', response.constructor.name);
  console.log('Content:', response.content);
  console.log('✅ Moonshot connection verified via ChatOpenAI');
}

verify().catch(console.error);
```

- [ ] **Step 3: 运行验证脚本**

```bash
npx tsx --env-file=.env src/llm/verify-moonshot.ts
```

Expected: 输出 `Response type: AIMessage`，Content 包含 "hello"，最后显示 ✅。

**如果失败**：检查 `MOONSHOT_API_KEY` 是否在 `.env` 中、baseURL 是否正确。若 `configuration.baseURL` 不生效，尝试改用 `OPENAI_BASE_URL` 环境变量。

- [ ] **Step 4: 删除验证脚本，Commit**

```bash
rm src/llm/verify-moonshot.ts
git add src/llm/model.ts
git commit -m "feat(llm): add ChatOpenAI model wrapper for Moonshot"
```

---

## Task 0.3: 创建消息格式转换辅助函数

**Files:**
- Create: `src/llm/model-helpers.ts`
- Create: `src/llm/__tests__/model-helpers.test.ts`

这是 Phase 0 的关键桥梁：让现有代码（使用 `ChatCompletionMessageParam`）能与 LangChain 类型（`BaseMessage`）互通。

- [ ] **Step 1: 写测试**

创建 `src/llm/__tests__/model-helpers.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { toBaseMessages, fromAIMessage } from '../model-helpers.js';

describe('toBaseMessages', () => {
  it('converts user message', () => {
    const result = toBaseMessages([{ role: 'user', content: 'hello' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(HumanMessage);
    expect(result[0].content).toBe('hello');
  });

  it('converts assistant message', () => {
    const result = toBaseMessages([{ role: 'assistant', content: 'hi' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(AIMessage);
    expect(result[0].content).toBe('hi');
  });

  it('converts system message', () => {
    const result = toBaseMessages([{ role: 'system', content: 'you are a tutor' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(SystemMessage);
  });

  it('converts mixed array preserving order', () => {
    const input = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
    ];
    const result = toBaseMessages(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeInstanceOf(SystemMessage);
    expect(result[1]).toBeInstanceOf(HumanMessage);
    expect(result[2]).toBeInstanceOf(AIMessage);
  });
});

describe('fromAIMessage', () => {
  it('extracts text content from AIMessage', () => {
    const msg = new AIMessage({ content: 'hello world' });
    expect(fromAIMessage(msg)).toBe('hello world');
  });

  it('returns empty string for empty content', () => {
    const msg = new AIMessage({ content: '' });
    expect(fromAIMessage(msg)).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/llm/__tests__/model-helpers.test.ts
```

Expected: FAIL — `model-helpers.js` 模块不存在。

- [ ] **Step 3: 实现转换函数**

创建 `src/llm/model-helpers.ts`：

```typescript
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatCompletionMessageParam } from 'openai/resources';

/**
 * 将 OpenAI SDK 的消息格式转为 LangChain BaseMessage 数组。
 * 这是 Phase 0 的桥梁函数：让现有代码的消息构建逻辑不变，
 * 只在调用 LLM 前做一次批量转换。
 */
export function toBaseMessages(
  messages: ChatCompletionMessageParam[]
): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage({ content: msg.content as string });
      case 'assistant':
        return new AIMessage({ content: (msg.content as string) ?? '' });
      case 'system':
        return new SystemMessage({ content: msg.content as string });
      case 'tool':
        return new ToolMessage({
          content: msg.content as string,
          tool_call_id: (msg as { tool_call_id: string }).tool_call_id,
        });
      default:
        return new HumanMessage({ content: String(msg.content) });
    }
  });
}

/**
 * 从 AIMessage 中提取文本内容。
 * AIMessage.content 可能是 string 或 ContentPart[]，
 * 这里只处理 string 场景（本项目不涉及多模态）。
 */
export function fromAIMessage(msg: AIMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return '';
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/llm/__tests__/model-helpers.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/llm/model-helpers.ts src/llm/__tests__/model-helpers.test.ts
git commit -m "feat(llm): add BaseMessage ↔ ChatCompletionMessageParam converters"
```

---

## Task 0.4: 改造 classifier.ts 使用 ChatOpenAI

**Files:**
- Modify: `src/classifier.ts`

classifier 是最简单的 LLM 调用点（单次调用、纯文本返回），适合作为第一个改造目标。

- [ ] **Step 1: 改造 classifier.ts**

将 `src/classifier.ts` 修改为：

```typescript
/**
 * 意图分类器（Router）
 *
 * 用一次轻量 LLM 调用判断用户输入属于哪个教学场景。
 * Phase 0 变更：从 OpenAI SDK 改为 ChatOpenAI。
 */
import { SystemMessage } from '@langchain/core/messages';
import { chatModel } from './llm/model.js';
import { fromAIMessage } from './llm/model-helpers.js';

export type Scenario = 'VOCABULARY' | 'GRAMMAR_CORRECTION' | 'EXPRESSION' | 'OFF_TOPIC';

const VALID_SCENARIOS: Scenario[] = ['VOCABULARY', 'GRAMMAR_CORRECTION', 'EXPRESSION', 'OFF_TOPIC'];

const classifyPrompt = (userMessage: string) => `
Classify the following user message into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- VOCABULARY: asking about word meanings, usage, or differences between similar words
- GRAMMAR_CORRECTION: writing English text that contains grammar, spelling, or usage errors
- EXPRESSION: asking how to say something in English (often translating from Chinese)
- OFF_TOPIC: anything unrelated to English learning

User message: "${userMessage}"
`.trim();

export async function classify(userMessage: string): Promise<Scenario> {
  const response = await chatModel.invoke([
    new SystemMessage(classifyPrompt(userMessage)),
  ]);

  const result = fromAIMessage(response).trim();

  if (VALID_SCENARIOS.includes(result as Scenario)) {
    return result as Scenario;
  }

  return 'OFF_TOPIC';
}
```

- [ ] **Step 2: 验证编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: 运行全量测试确认无回归**

```bash
npm test
```

Expected: 所有现有测试通过。

- [ ] **Step 4: Commit**

```bash
git add src/classifier.ts
git commit -m "refactor(classifier): migrate from OpenAI SDK to ChatOpenAI"
```

---

## Task 0.5: 改造 dictionary.ts 为 StructuredTool

**Files:**
- Modify: `src/tools/dictionary.ts`

- [ ] **Step 1: 改造 dictionary.ts**

将 `src/tools/dictionary.ts` 改造为：

```typescript
/**
 * 字典工具模块 — 使用 LangChain StructuredTool
 *
 * Phase 0 变更：从 ChatCompletionTool JSON Schema 对象改为 StructuredTool 类。
 * lookupWord 核心逻辑不变，只是包装方式变了。
 */
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * LangChain StructuredTool 版本的字典查询工具。
 * chatModel.bindTools([dictionaryTool]) 时，LangChain 自动从 schema 生成 JSON Schema。
 */
export class DictionaryTool extends StructuredTool {
  name = 'lookupWord';
  description =
    '查询英语单词的详细定义、音标、例句和同义词。当用户询问某个英语单词的含义、用法时使用此工具，获取准确的字典数据。';
  schema = z.object({
    word: z.string().describe('要查询的英语单词，只传单个单词，不含标点和空格'),
  });

  async _call({ word }: z.infer<typeof this.schema>): Promise<string> {
    return lookupWord(word);
  }
}

export const dictionaryTool = new DictionaryTool();

/**
 * 调用 Free Dictionary API 查询单词。核心逻辑与改造前完全一致。
 */
export async function lookupWord(word: string): Promise<string> {
  const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;

  try {
    const response = await fetch(apiUrl);

    if (!response.ok) {
      return `Dictionary lookup failed for '${word}': word not found (HTTP ${response.status}). Please answer based on your own knowledge.`;
    }

    const data = (await response.json()) as DictionaryEntry[];
    const entry = data[0];

    if (!entry) {
      return `Dictionary lookup failed for '${word}': empty response. Please answer based on your own knowledge.`;
    }

    const phonetic =
      entry.phonetics?.find((p) => p.text)?.text ?? entry.phonetic ?? 'N/A';

    const meaningsText = entry.meanings
      ?.slice(0, 3)
      .map((meaning) => {
        const definitions = meaning.definitions
          .slice(0, 2)
          .map((def, idx) => {
            const example = def.example ? ` Example: "${def.example}"` : '';
            return `  ${idx + 1}. ${def.definition}${example}`;
          })
          .join('\n');

        const synonyms = meaning.synonyms?.slice(0, 3).join(', ');
        const synonymsText = synonyms ? `\n  Synonyms: ${synonyms}` : '';

        return `[${meaning.partOfSpeech}]\n${definitions}${synonymsText}`;
      })
      .join('\n\n');

    return `Word: ${entry.word}\nPhonetic: ${phonetic}\n\n${meaningsText}`;
  } catch (error) {
    return `Dictionary lookup failed for '${word}' due to an error. Please answer based on your own knowledge.`;
  }
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: {
    partOfSpeech: string;
    definitions: {
      definition: string;
      example?: string;
      synonyms?: string[];
    }[];
    synonyms?: string[];
  }[];
}
```

注意：移除了原来的 `executeToolCall` 路由函数。在 LangChain 中，工具路由由框架自动处理——`ToolNode` 或手动调用 `tool.invoke()` 即可。

- [ ] **Step 2: 验证编译通过**

```bash
npx tsc --noEmit
```

Expected: 可能会有 `chat-service.ts` 报错（因为它还在引用旧的 `dictionaryTool` 格式和 `executeToolCall`）。这是预期的——下一个 Task 会处理。

- [ ] **Step 3: Commit（允许临时编译错误）**

```bash
git add src/tools/dictionary.ts
git commit -m "refactor(tools): migrate dictionary to LangChain StructuredTool"
```

---

## Task 0.6: 改造 chat-service.ts 适配 LangChain 类型

**Files:**
- Modify: `src/services/chat-service.ts`

这是 Phase 0 最大的改动，但**编排逻辑完全不变**——只是底层调用从 OpenAI SDK 换为 LangChain 类型。

- [ ] **Step 1: 改造 chat-service.ts**

将 `src/services/chat-service.ts` 改造为：

```typescript
/**
 * 核心对话函数 — Agent 的"调度中心"
 *
 * Phase 0 变更：底层调用从 OpenAI SDK 改为 LangChain (ChatOpenAI + StructuredTool)。
 * 编排逻辑（分类→组装→工具循环→返回）完全不变。
 */
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { chatModel, summaryModel } from '../llm/model.js';
import { toBaseMessages, fromAIMessage } from '../llm/model-helpers.js';
import { classify, Scenario } from '../classifier.js';
import { baseSystemPrompt } from '../prompts/base.js';
import { vocabularyCot, vocabularyFewShot } from '../prompts/vocabulary.js';
import { grammarCot, grammarFewShot } from '../prompts/grammar.js';
import { expressionCot, expressionFewShot } from '../prompts/expression.js';
import { offTopicCot } from '../prompts/offTopic.js';
import { formatRagContext } from '../prompts/rag.js';
import { initChromaRag, retrieveFromChroma } from '../rag/chroma-store.js';
import { dictionaryTool } from '../tools/dictionary.js';
import {
  CHAT_MODEL,
  COMPRESS_THRESHOLD,
  KEEP_RECENT_ROUNDS,
  RAG_TOP_K,
  RAG_MIN_SCORE,
  MAX_TOOL_ITERATIONS,
  SUMMARY_MAX_TOKENS,
} from '../config.js';
import { Session, ChatResult } from '../types/session.js';
import { ChatCompletionMessageParam } from 'openai/resources';

const scenarioConfig: Record<
  Scenario,
  { cot: string; fewShot: ChatCompletionMessageParam[] }
> = {
  VOCABULARY: { cot: vocabularyCot, fewShot: vocabularyFewShot },
  GRAMMAR_CORRECTION: { cot: grammarCot, fewShot: grammarFewShot },
  EXPRESSION: { cot: expressionCot, fewShot: expressionFewShot },
  OFF_TOPIC: { cot: offTopicCot, fewShot: [] },
};

let chromaReady: boolean | undefined;
let chromaInitPromise: Promise<void> | undefined;

export async function preloadRagKnowledge(): Promise<void> {
  if (!process.env.CHROMA_URL) return;
  if (!chromaInitPromise) {
    chromaInitPromise = initChromaRag()
      .then((ok) => {
        chromaReady = ok;
        console.log(ok ? '  [RAG] Chroma 已就绪' : '  [RAG] Chroma 初始化失败，本次不使用 RAG');
      })
      .catch((err) => {
        chromaReady = false;
        console.warn('  [RAG] Chroma 连接异常，本次不使用 RAG:', err);
      });
  }
  await chromaInitPromise;
}

function logContextStatus(label: string, messageCount?: number, session?: Session) {
  const history = session?.history ?? [];
  const summary = session?.summary ?? '';
  const rounds = history.length / 2;
  const summaryStatus = summary
    ? `"${summary.slice(0, 60)}${summary.length > 60 ? '...' : ''}"`
    : '无';
  const lines = [
    `│  历史轮数:    ${rounds} 轮 (${history.length} 条消息)`,
    `│  摘要状态:    ${summaryStatus}`,
  ];
  if (messageCount !== undefined) {
    lines.push(
      `│  发送消息总数: ${messageCount} 条 (system + fewshot + history + 当前输入)`
    );
  }
  const width = 58;
  console.log(`  ╭${'─'.repeat(width)}╮`);
  console.log(
    `  │ 📊 ${label}${' '.repeat(Math.max(0, width - label.length - 4))}│`
  );
  console.log(`  ├${'─'.repeat(width)}┤`);
  for (const line of lines) {
    console.log(
      `  ${line}${' '.repeat(Math.max(0, width + 2 - line.length))}│`
    );
  }
  console.log(`  ╰${'─'.repeat(width)}╯`);
}

async function generateSummary(
  messages: ChatCompletionMessageParam[],
  previousSummary: string
): Promise<string> {
  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const summaryPrompt = previousSummary
    ? `以下是之前的对话摘要：\n${previousSummary}\n\n以下是最近的对话内容：\n${conversationText}\n\n请将以上所有信息总结成1-2句话的摘要，用中文概括主要讨论内容和用户的学习重点。`
    : `请总结以下对话的关键信息，用1-2句话概括主要讨论内容和用户的学习重点。\n\n${conversationText}`;

  const response = await summaryModel.invoke([
    new SystemMessage('你是一个对话摘要助手。请用简洁的中文总结对话内容，保留关键学习点和用户水平信息。'),
    new HumanMessage(summaryPrompt),
  ]);

  return fromAIMessage(response).trim();
}

async function compressHistory(session: Session): Promise<void> {
  const totalRounds = session.history.length / 2;
  if (totalRounds < COMPRESS_THRESHOLD) return;

  logContextStatus('压缩前 (Before Compression)', undefined, session);
  console.log(
    `  ⚡ [Memory] 触发压缩! ${totalRounds} 轮 > 阈值 ${COMPRESS_THRESHOLD} 轮，正在生成摘要...`
  );

  const keepMessages = KEEP_RECENT_ROUNDS * 2;
  const oldMessages = session.history.slice(0, -keepMessages);
  const recentMessages = session.history.slice(-keepMessages);

  const newSummary = await generateSummary(oldMessages, session.summary);
  console.log(`  [Memory] 被压缩的消息数: ${oldMessages.length} 条`);
  console.log(`  [Memory] LLM 返回的摘要: "${newSummary}"`);

  session.summary = newSummary;
  session.history = recentMessages;

  logContextStatus('压缩后 (After Compression)', undefined, session);
}

async function buildSystemPrompt(
  scenario: Scenario,
  cot: string,
  summary: string,
  userMessage: string
): Promise<string> {
  let systemPrompt = baseSystemPrompt + '\n\n' + cot;

  if (summary) {
    systemPrompt += `\n\n[历史摘要] ${summary}`;
  }

  if (scenario !== 'OFF_TOPIC' && chromaReady) {
    try {
      const top = (await retrieveFromChroma(userMessage, RAG_TOP_K))
        .filter((t) => t.score >= RAG_MIN_SCORE);
      if (top.length > 0) {
        systemPrompt += '\n\n' + formatRagContext(top);
        console.log(
          `  [RAG] 已注入 ${top.length} 条（分数: ${top.map((t) => t.score.toFixed(3)).join(', ')})`
        );
      }
    } catch (err) {
      console.warn('  [RAG] 检索失败，跳过上下文注入:', err);
    }
  }

  return systemPrompt;
}

/**
 * Tool Use Loop — 使用 LangChain ChatOpenAI 的 bindTools + invoke。
 * 逻辑与改造前完全一致：持续调用直到无 tool_calls 或达到上限。
 */
async function runToolLoop(
  messages: ChatCompletionMessageParam[],
  useTools: boolean
): Promise<string> {
  const loopMessages: BaseMessage[] = toBaseMessages(messages);
  let reply = '';
  let iterations = 0;

  const model = useTools
    ? chatModel.bindTools([dictionaryTool])
    : chatModel;

  while (true) {
    iterations++;
    if (iterations > MAX_TOOL_ITERATIONS) {
      console.log(`  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`);
      break;
    }

    const response = await model.invoke(loopMessages);
    loopMessages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        console.log(`  [Tool] 调用函数: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

        const toolResult = await dictionaryTool.invoke(toolCall.args);

        console.log(
          `  [Tool] 执行结果: ${toolResult.slice(0, 100)}${toolResult.length > 100 ? '...' : ''}`
        );

        const { ToolMessage } = await import('@langchain/core/messages');
        loopMessages.push(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id ?? '',
          })
        );
      }
      continue;
    }

    reply = fromAIMessage(response);
    break;
  }

  return reply;
}

export async function chat(session: Session, userMessage: string): Promise<ChatResult> {
  const [scenario] = await Promise.all([classify(userMessage), compressHistory(session)]);
  console.log(`  [Router] Detected scenario: ${scenario}`);

  const { cot, fewShot } = scenarioConfig[scenario];
  const systemPrompt = await buildSystemPrompt(scenario, cot, session.summary, userMessage);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...fewShot,
    ...session.history,
    { role: 'user', content: userMessage },
  ];

  logContextStatus(
    `第 ${session.history.length / 2 + 1} 轮对话`,
    messages.length,
    session
  );

  const useTools = scenario === 'VOCABULARY';
  const reply = await runToolLoop(messages, useTools);

  session.history.push({ role: 'user', content: userMessage });
  session.history.push({ role: 'assistant', content: reply });

  return { reply, scenario };
}
```

**关键变更说明：**
- `runToolLoop` 内部：消息从 `ChatCompletionMessageParam[]` 转为 `BaseMessage[]`（通过 `toBaseMessages`）
- 工具调用：从手动 `executeToolCall` 路由改为 `dictionaryTool.invoke()`（LangChain 自动调度）
- `generateSummary`：从 `client.chat.completions.create()` 改为 `summaryModel.invoke()`
- 其余所有编排逻辑（`chat`、`compressHistory`、`buildSystemPrompt`）不变

- [ ] **Step 2: 验证编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误。如果有 import 路径问题，检查 `tsconfig.json` 的 paths 配置。

- [ ] **Step 3: 运行全量测试**

```bash
npm test
```

Expected: 所有现有测试通过（这些测试不直接测试 chat-service，所以不受影响）。

- [ ] **Step 4: Commit**

```bash
git add src/services/chat-service.ts
git commit -m "refactor(chat-service): migrate LLM calls from OpenAI SDK to ChatOpenAI"
```

---

## Task 0.7: 清理旧 client.ts + 更新 server.ts import

**Files:**
- Delete: `src/client.ts`
- Modify: `src/server.ts`（如果它 import 了 client.ts）

- [ ] **Step 1: 确认无其他文件引用 `src/client.ts`**

搜索项目中所有 `from '../client` 或 `from './client` 的引用。应该只有 `classifier.ts`（已改造）和 `chat-service.ts`（已改造）。如果 `embedding.ts` 使用了独立的 OpenAI 实例（它确实如此），则不受影响。

- [ ] **Step 2: 删除 `src/client.ts`**

```bash
rm src/client.ts
```

- [ ] **Step 3: 验证编译 + 测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 编译无错误，测试全通过。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy OpenAI client, all LLM calls now use ChatOpenAI"
```

---

## Task 0.8: Phase 0 端到端手动验证

- [ ] **Step 1: 启动后端服务**

```bash
npm run dev:server
```

Expected: 启动成功，无异常日志。

- [ ] **Step 2: 在另一个终端中测试四种场景**

用 curl 或前端测试：

```bash
# VOCABULARY
curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"What does \"resilient\" mean?"}'

# GRAMMAR_CORRECTION
curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"I go to school yesterday"}'

# EXPRESSION
curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"怎么用英语表达感到焦虑？"}'

# OFF_TOPIC
curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"帮我写一段Python代码"}'
```

Expected: 四种场景均返回正确的 `reply` 和 `scenario`，行为与改造前一致。

- [ ] **Step 3: 验证工具调用**

在 VOCABULARY 请求的后端日志中确认：
- `[Tool] 调用函数: lookupWord(...)` 被打印
- `[Tool] 执行结果: Word: resilient...` 包含真实字典数据

- [ ] **Step 4: Phase 0 掌控度自检**

回答以下问题（在脑中或写下来）：
- [ ] ChatOpenAI 如何通过 `configuration.baseURL` 兼容 Moonshot？
- [ ] 手动将 `{ role: 'user', content: 'hello' }` 转换为对应的 BaseMessage 子类是什么？
- [ ] StructuredTool 的 `_call` 方法在什么时候被调用？
- [ ] `chatModel.invoke()` 和 `chatModel.stream()` 的统一调用接口设计意图是什么？

---

# ═══════════════════════════════════════════════════════
# 迁移 Phase 1：最简 StateGraph（线性图）
# ═══════════════════════════════════════════════════════

> **学习目标：** StateGraph、Annotation、Node 函数签名、addEdge、graph.invoke()
>
> **完成标准：** chat() 通过 graph.invoke() 实现，图为线性（无条件边/循环），功能完全不变

---

## Task 1.1: 安装 LangGraph

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装**

```bash
npm install @langchain/langgraph
```

- [ ] **Step 2: 验证**

```bash
npm ls @langchain/langgraph
npm test
```

Expected: 版本号显示正常，现有测试通过。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @langchain/langgraph dependency"
```

---

## Task 1.2: 定义 TutorState Annotation

**Files:**
- Create: `src/graph/state.ts`

- [ ] **Step 1: 创建 `src/graph/state.ts`**

```typescript
import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { Scenario } from '../classifier.js';

/**
 * 图的全局状态定义。
 * 每个节点从 State 中读取输入字段，返回要更新的输出字段。
 * messages 使用 reducer（追加模式），其余字段为覆盖模式。
 */
export const TutorState = Annotation.Root({
  userMessage: Annotation<string>,

  scenario: Annotation<Scenario>,

  history: Annotation<BaseMessage[]>,
  summary: Annotation<string>,
  compressedHistory: Annotation<BaseMessage[]>,
  compressedSummary: Annotation<string>,

  systemPrompt: Annotation<string>,
  fewShot: Annotation<BaseMessage[]>,
  hasTools: Annotation<boolean>,

  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...(current ?? []), ...update],
    default: () => [],
  }),

  reply: Annotation<string>,
});

export type TutorStateType = typeof TutorState.State;
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/graph/state.ts
git commit -m "feat(graph): define TutorState Annotation"
```

---

## Task 1.3: 创建消息格式适配器

**Files:**
- Create: `src/graph/adapters.ts`

- [ ] **Step 1: 创建 `src/graph/adapters.ts`**

```typescript
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatCompletionMessageParam } from 'openai/resources';

/**
 * 将 Session.history (ChatCompletionMessageParam[]) 转为 BaseMessage[]。
 * 用于 graph.invoke() 前的输入准备。
 */
export function sessionHistoryToBaseMessages(
  history: ChatCompletionMessageParam[]
): BaseMessage[] {
  return history.map((msg) => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage({ content: msg.content as string });
      case 'assistant':
        return new AIMessage({ content: (msg.content as string) ?? '' });
      case 'system':
        return new SystemMessage({ content: msg.content as string });
      default:
        return new HumanMessage({ content: String(msg.content) });
    }
  });
}

/**
 * 将 BaseMessage[] 转回 ChatCompletionMessageParam[]。
 * 用于 graph.invoke() 后写回 Session.history。
 */
export function baseMessagesToSessionHistory(
  messages: BaseMessage[]
): ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg._getType() === 'human') {
      return { role: 'user' as const, content: msg.content as string };
    }
    if (msg._getType() === 'ai') {
      return { role: 'assistant' as const, content: (msg.content as string) ?? '' };
    }
    if (msg._getType() === 'system') {
      return { role: 'system' as const, content: msg.content as string };
    }
    return { role: 'user' as const, content: String(msg.content) };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/graph/adapters.ts
git commit -m "feat(graph): add session ↔ BaseMessage adapters"
```

---

## Task 1.4: 创建各节点（classify、compress、buildPrompt、callLLM、respond）

**Files:**
- Create: `src/graph/nodes/classify.ts`
- Create: `src/graph/nodes/compress.ts`
- Create: `src/graph/nodes/build-prompt.ts`
- Create: `src/graph/nodes/call-llm.ts`
- Create: `src/graph/nodes/respond.ts`

每个节点是一个函数：接收 `TutorStateType`，返回 `Partial<TutorStateType>`。

- [ ] **Step 1: 创建 classify 节点**

创建 `src/graph/nodes/classify.ts`：

```typescript
import { classify } from '../../classifier.js';
import type { TutorStateType } from '../state.js';

export async function classifyNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  const scenario = await classify(state.userMessage);
  console.log(`  [Router] Detected scenario: ${scenario}`);
  return { scenario };
}
```

- [ ] **Step 2: 创建 compress 节点**

创建 `src/graph/nodes/compress.ts`：

```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { summaryModel } from '../../llm/model.js';
import { fromAIMessage } from '../../llm/model-helpers.js';
import { COMPRESS_THRESHOLD, KEEP_RECENT_ROUNDS } from '../../config.js';
import type { TutorStateType } from '../state.js';

export async function compressNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  const { history, summary } = state;
  const totalRounds = history.length / 2;

  if (totalRounds < COMPRESS_THRESHOLD) {
    return { compressedHistory: history, compressedSummary: summary };
  }

  console.log(`  ⚡ [Memory] 触发压缩! ${totalRounds} 轮 > 阈值 ${COMPRESS_THRESHOLD} 轮`);

  const keepMessages = KEEP_RECENT_ROUNDS * 2;
  const oldMessages = history.slice(0, -keepMessages);
  const recentMessages = history.slice(-keepMessages);

  const conversationText = oldMessages
    .map((m) => `${m._getType()}: ${m.content}`)
    .join('\n');

  const summaryPromptText = summary
    ? `以下是之前的对话摘要：\n${summary}\n\n以下是最近的对话内容：\n${conversationText}\n\n请将以上所有信息总结成1-2句话的摘要，用中文概括主要讨论内容和用户的学习重点。`
    : `请总结以下对话的关键信息，用1-2句话概括主要讨论内容和用户的学习重点。\n\n${conversationText}`;

  const response = await summaryModel.invoke([
    new SystemMessage('你是一个对话摘要助手。请用简洁的中文总结对话内容，保留关键学习点和用户水平信息。'),
    new HumanMessage(summaryPromptText),
  ]);

  const newSummary = fromAIMessage(response).trim();
  console.log(`  [Memory] LLM 返回的摘要: "${newSummary}"`);

  return { compressedHistory: recentMessages, compressedSummary: newSummary };
}
```

- [ ] **Step 3: 创建 buildPrompt 节点**

创建 `src/graph/nodes/build-prompt.ts`：

```typescript
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatCompletionMessageParam } from 'openai/resources';
import { baseSystemPrompt } from '../../prompts/base.js';
import { vocabularyCot, vocabularyFewShot } from '../../prompts/vocabulary.js';
import { grammarCot, grammarFewShot } from '../../prompts/grammar.js';
import { expressionCot, expressionFewShot } from '../../prompts/expression.js';
import { offTopicCot } from '../../prompts/offTopic.js';
import { formatRagContext } from '../../prompts/rag.js';
import { retrieveFromChroma, isChromaReady } from '../../rag/chroma-store.js';
import { RAG_TOP_K, RAG_MIN_SCORE } from '../../config.js';
import type { Scenario } from '../../classifier.js';
import type { TutorStateType } from '../state.js';

const scenarioConfig: Record<
  Scenario,
  { cot: string; fewShot: ChatCompletionMessageParam[] }
> = {
  VOCABULARY: { cot: vocabularyCot, fewShot: vocabularyFewShot },
  GRAMMAR_CORRECTION: { cot: grammarCot, fewShot: grammarFewShot },
  EXPRESSION: { cot: expressionCot, fewShot: expressionFewShot },
  OFF_TOPIC: { cot: offTopicCot, fewShot: [] },
};

function fewShotToBaseMessages(fewShot: ChatCompletionMessageParam[]): BaseMessage[] {
  return fewShot.map((msg) => {
    if (msg.role === 'user') return new HumanMessage({ content: msg.content as string });
    if (msg.role === 'assistant') return new AIMessage({ content: (msg.content as string) ?? '' });
    return new SystemMessage({ content: msg.content as string });
  });
}

export async function buildPromptNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  const { scenario, compressedSummary, compressedHistory, userMessage } = state;
  const { cot, fewShot } = scenarioConfig[scenario];

  let systemPrompt = baseSystemPrompt + '\n\n' + cot;

  if (compressedSummary) {
    systemPrompt += `\n\n[历史摘要] ${compressedSummary}`;
  }

  if (scenario !== 'OFF_TOPIC' && isChromaReady()) {
    try {
      const top = (await retrieveFromChroma(userMessage, RAG_TOP_K))
        .filter((t) => t.score >= RAG_MIN_SCORE);
      if (top.length > 0) {
        systemPrompt += '\n\n' + formatRagContext(top);
        console.log(`  [RAG] 已注入 ${top.length} 条`);
      }
    } catch (err) {
      console.warn('  [RAG] 检索失败，跳过上下文注入:', err);
    }
  }

  const initialMessages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...fewShotToBaseMessages(fewShot),
    ...compressedHistory,
    new HumanMessage(userMessage),
  ];

  return {
    systemPrompt,
    fewShot: fewShotToBaseMessages(fewShot),
    hasTools: scenario === 'VOCABULARY',
    messages: initialMessages,
  };
}
```

**注意**：此节点需要从 `chroma-store.ts` 导入 `isChromaReady()`。需要在 `chroma-store.ts` 中导出此函数（Task 1.5 处理）。

- [ ] **Step 4: 创建 callLLM 节点**

创建 `src/graph/nodes/call-llm.ts`：

```typescript
import { chatModel } from '../../llm/model.js';
import { fromAIMessage } from '../../llm/model-helpers.js';
import { dictionaryTool } from '../../tools/dictionary.js';
import { MAX_TOOL_ITERATIONS } from '../../config.js';
import { ToolMessage } from '@langchain/core/messages';
import type { TutorStateType } from '../state.js';

/**
 * Phase 1 版本：内部仍包含工具循环（Phase 3 会拆出来）。
 * 读取 state.messages，调用 LLM，处理工具调用，返回最终回复。
 */
export async function callLLMNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  const model = state.hasTools
    ? chatModel.bindTools([dictionaryTool])
    : chatModel;

  let loopMessages = [...state.messages];
  let iterations = 0;

  while (true) {
    iterations++;
    if (iterations > MAX_TOOL_ITERATIONS) {
      console.log(`  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`);
      break;
    }

    const response = await model.invoke(loopMessages);
    loopMessages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        console.log(`  [Tool] 调用函数: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
        const toolResult = await dictionaryTool.invoke(toolCall.args);
        console.log(`  [Tool] 执行结果: ${toolResult.slice(0, 100)}${toolResult.length > 100 ? '...' : ''}`);
        loopMessages.push(new ToolMessage({ content: toolResult, tool_call_id: toolCall.id ?? '' }));
      }
      continue;
    }

    return { messages: loopMessages, reply: fromAIMessage(response) };
  }

  const lastAI = loopMessages.filter((m) => m._getType() === 'ai').pop();
  return {
    messages: loopMessages,
    reply: lastAI ? (lastAI.content as string) ?? '' : '抱歉，我暂时无法完成查询，请稍后再试。',
  };
}
```

- [ ] **Step 5: 创建 respond 节点**

创建 `src/graph/nodes/respond.ts`：

```typescript
import type { TutorStateType } from '../state.js';

/**
 * 图的最终节点：reply 已在 callLLM 中设置，此节点做透传。
 * Phase 2+ 中此节点可扩展后处理逻辑（如日志、指标）。
 */
export async function respondNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  return { reply: state.reply };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/graph/nodes/
git commit -m "feat(graph): create all graph nodes (classify, compress, buildPrompt, callLLM, respond)"
```

---

## Task 1.5: 导出 chromaReady 状态函数

**Files:**
- Modify: `src/rag/chroma-store.ts`

`buildPromptNode` 需要知道 Chroma 是否就绪。当前 `chromaReady` 是 `chat-service.ts` 的模块级变量。需要将其移到或暴露于 `chroma-store.ts`。

- [ ] **Step 1: 在 `chroma-store.ts` 中添加 `isChromaReady()` 导出函数**

在 `src/rag/chroma-store.ts` 文件末尾添加：

```typescript
/** 供图节点查询 Chroma 是否已初始化就绪 */
export function isChromaReady(): boolean {
  // chromaReady 是此文件中的模块级变量（initChromaRag 成功后设为 true）
  // 如果该变量目前不在 chroma-store.ts 中，需要在此文件中维护它
  return chromaReady === true;
}
```

如果 `chromaReady` 当前在 `chat-service.ts` 中而非 `chroma-store.ts` 中，需要将其移到 `chroma-store.ts`。查看当前 `chroma-store.ts` 的实现确定具体做法。

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/rag/chroma-store.ts
git commit -m "refactor(rag): export isChromaReady() for graph node access"
```

---

## Task 1.6: 组装线性图并 compile

**Files:**
- Create: `src/graph/index.ts`

- [ ] **Step 1: 创建 `src/graph/index.ts`**

```typescript
import { StateGraph } from '@langchain/langgraph';
import { TutorState } from './state.js';
import { classifyNode } from './nodes/classify.js';
import { compressNode } from './nodes/compress.js';
import { buildPromptNode } from './nodes/build-prompt.js';
import { callLLMNode } from './nodes/call-llm.js';
import { respondNode } from './nodes/respond.js';

/**
 * Phase 1：线性图（无条件边、无并行、无循环）。
 * classify → compress → buildPrompt → callLLM → respond
 */
const workflow = new StateGraph(TutorState)
  .addNode('classify', classifyNode)
  .addNode('compress', compressNode)
  .addNode('buildPrompt', buildPromptNode)
  .addNode('callLLM', callLLMNode)
  .addNode('respond', respondNode)
  .addEdge('__start__', 'classify')
  .addEdge('classify', 'compress')
  .addEdge('compress', 'buildPrompt')
  .addEdge('buildPrompt', 'callLLM')
  .addEdge('callLLM', 'respond')
  .addEdge('respond', '__end__');

export const tutorGraph = workflow.compile();
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/graph/index.ts
git commit -m "feat(graph): assemble linear StateGraph (Phase 1)"
```

---

## Task 1.7: 重写 chat-service.ts 为图调用薄包装

**Files:**
- Rewrite: `src/services/chat-service.ts`

- [ ] **Step 1: 重写 `src/services/chat-service.ts`**

```typescript
/**
 * 核心对话函数 — 现在是 graph.invoke() 的薄包装。
 *
 * Phase 1 变更：编排逻辑移至 src/graph/，此文件只负责：
 * 1. 将 Session 数据转为图的输入 State
 * 2. 调用 graph.invoke()
 * 3. 将图的输出 State 写回 Session
 */
import { tutorGraph } from '../graph/index.js';
import { sessionHistoryToBaseMessages, baseMessagesToSessionHistory } from '../graph/adapters.js';
import { initChromaRag } from '../rag/chroma-store.js';
import { Session, ChatResult } from '../types/session.js';

let chromaInitPromise: Promise<void> | undefined;

export async function preloadRagKnowledge(): Promise<void> {
  if (!process.env.CHROMA_URL) return;
  if (!chromaInitPromise) {
    chromaInitPromise = initChromaRag()
      .then((ok) => {
        console.log(ok ? '  [RAG] Chroma 已就绪' : '  [RAG] Chroma 初始化失败');
      })
      .catch((err) => {
        console.warn('  [RAG] Chroma 连接异常:', err);
      });
  }
  await chromaInitPromise;
}

export async function chat(session: Session, userMessage: string): Promise<ChatResult> {
  const result = await tutorGraph.invoke({
    userMessage,
    history: sessionHistoryToBaseMessages(session.history),
    summary: session.summary,
  });

  session.history = baseMessagesToSessionHistory(result.compressedHistory);
  session.summary = result.compressedSummary;
  session.history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: result.reply }
  );

  return { reply: result.reply, scenario: result.scenario };
}
```

- [ ] **Step 2: 验证编译 + 测试**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/services/chat-service.ts
git commit -m "refactor(chat-service): replace orchestration with graph.invoke() wrapper"
```

---

## Task 1.8: Phase 1 端到端手动验证

- [ ] **Step 1: 启动服务并测试四种场景**

```bash
npm run dev:server
```

与 Task 0.8 相同的四条 curl 命令测试。

Expected: 行为与 Phase 0 完全一致。后端日志中应能看到图的节点执行顺序。

- [ ] **Step 2: Phase 1 掌控度自检**

- [ ] 能手绘 Phase 1 的图结构（5 个节点，5 条线性边）
- [ ] 能解释 `graph.invoke({ userMessage, history, summary })` 执行时，State 在每个节点间如何传递
- [ ] 能解释为什么节点函数返回的是 Partial<TutorStateType> 而不是完整 State
- [ ] 能说出 `messages` 字段的 reducer 的作用
- [ ] 所有现有测试通过

---

# ═══════════════════════════════════════════════════════
# 迁移 Phase 2：条件边 + 并行
# ═══════════════════════════════════════════════════════

> **学习目标：** addConditionalEdges、并行 fan-out / fan-in、State 合并规则
>
> **完成标准：** classify 和 compress 并行执行，图结构与 spec §4.2 一致

---

## Task 2.1: 改为并行 fan-out（classify + compress）

**Files:**
- Modify: `src/graph/index.ts`

- [ ] **Step 1: 修改图的边定义**

将 `src/graph/index.ts` 中的线性边改为并行：

```typescript
import { StateGraph } from '@langchain/langgraph';
import { TutorState } from './state.js';
import { classifyNode } from './nodes/classify.js';
import { compressNode } from './nodes/compress.js';
import { buildPromptNode } from './nodes/build-prompt.js';
import { callLLMNode } from './nodes/call-llm.js';
import { respondNode } from './nodes/respond.js';

/**
 * Phase 2：并行 fan-out (classify + compress) → fan-in (buildPrompt)。
 *
 * __start__ ──→ classify  ──→ buildPrompt ──→ callLLM ──→ respond ──→ __end__
 * __start__ ──→ compress  ──→ buildPrompt
 *
 * classify 写 scenario，compress 写 compressedHistory/compressedSummary，
 * 两者写不同字段，不冲突。buildPrompt 在两者都完成后才执行。
 */
const workflow = new StateGraph(TutorState)
  .addNode('classify', classifyNode)
  .addNode('compress', compressNode)
  .addNode('buildPrompt', buildPromptNode)
  .addNode('callLLM', callLLMNode)
  .addNode('respond', respondNode)
  // 并行 fan-out
  .addEdge('__start__', 'classify')
  .addEdge('__start__', 'compress')
  // fan-in：两者都完成后才进入 buildPrompt
  .addEdge('classify', 'buildPrompt')
  .addEdge('compress', 'buildPrompt')
  // 线性
  .addEdge('buildPrompt', 'callLLM')
  .addEdge('callLLM', 'respond')
  .addEdge('respond', '__end__');

export const tutorGraph = workflow.compile();
```

- [ ] **Step 2: 验证编译 + 测试**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 3: 端到端验证并行执行**

启动服务，发送一条消息，观察后端日志。`[Router] Detected scenario` 和 `[Memory]` 日志应接近同时出现（而非严格顺序）。

- [ ] **Step 4: Commit**

```bash
git add src/graph/index.ts
git commit -m "feat(graph): add parallel fan-out for classify + compress (Phase 2)"
```

---

## Task 2.2: Phase 2 掌控度自检

- [ ] 能画出并行 fan-out 和 fan-in 的图结构
- [ ] 能解释为什么 classify 和 compress 可以安全并行（写不同字段）
- [ ] 能说出如果新增一个场景（如 PRONUNCIATION），需要改哪些文件
- [ ] 所有现有测试通过 + 手动验证四种场景

---

# ═══════════════════════════════════════════════════════
# 迁移 Phase 3：图内工具循环
# ═══════════════════════════════════════════════════════

> **学习目标：** Cycle（图内循环）、条件边路由函数、循环终止控制
>
> **完成标准：** 工具循环从 callLLM 内部的 while 拆为图级 callLLM ↔ executeTools 循环

---

## Task 3.1: 新增 toolIterations 字段到 State

**Files:**
- Modify: `src/graph/state.ts`

- [ ] **Step 1: 添加字段**

在 `TutorState` 中新增：

```typescript
  toolIterations: Annotation<number>({
    default: () => 0,
  }),
```

- [ ] **Step 2: Commit**

```bash
git add src/graph/state.ts
git commit -m "feat(graph): add toolIterations to state for cycle control"
```

---

## Task 3.2: 创建独立的 executeTools 节点

**Files:**
- Create: `src/graph/nodes/execute-tools.ts`

- [ ] **Step 1: 创建节点**

创建 `src/graph/nodes/execute-tools.ts`：

```typescript
import { ToolMessage } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
import { dictionaryTool } from '../../tools/dictionary.js';
import type { TutorStateType } from '../state.js';

/**
 * 工具执行节点：读取最后一条 AI 消息的 tool_calls，执行工具，返回结果。
 * 每次执行后 toolIterations + 1，供条件边判断是否终止循环。
 */
export async function executeToolsNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  const lastMessage = state.messages.at(-1) as AIMessage;
  const toolCalls = lastMessage.tool_calls ?? [];
  const toolMessages = [];

  for (const toolCall of toolCalls) {
    console.log(`  [Tool] 调用函数: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
    const result = await dictionaryTool.invoke(toolCall.args);
    console.log(`  [Tool] 执行结果: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);
    toolMessages.push(
      new ToolMessage({ content: result, tool_call_id: toolCall.id ?? '' })
    );
  }

  return {
    messages: toolMessages,
    toolIterations: (state.toolIterations ?? 0) + 1,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/graph/nodes/execute-tools.ts
git commit -m "feat(graph): create executeTools node for graph-level tool loop"
```

---

## Task 3.3: 简化 callLLM 为单次调用

**Files:**
- Modify: `src/graph/nodes/call-llm.ts`

- [ ] **Step 1: 移除内部 while 循环**

将 `src/graph/nodes/call-llm.ts` 替换为：

```typescript
import { chatModel } from '../../llm/model.js';
import { fromAIMessage } from '../../llm/model-helpers.js';
import { dictionaryTool } from '../../tools/dictionary.js';
import type { TutorStateType } from '../state.js';

/**
 * Phase 3 版本：单次 LLM 调用。循环由图级边控制。
 * 如果有 tool_calls，条件边会路由到 executeTools，然后回到这里。
 */
export async function callLLMNode(
  state: TutorStateType
): Promise<Partial<TutorStateType>> {
  const model = state.hasTools
    ? chatModel.bindTools([dictionaryTool])
    : chatModel;

  const response = await model.invoke(state.messages);

  const reply = (!response.tool_calls || response.tool_calls.length === 0)
    ? fromAIMessage(response)
    : '';

  return {
    messages: [response],
    reply,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/graph/nodes/call-llm.ts
git commit -m "refactor(graph): simplify callLLM to single invocation (loop via graph edges)"
```

---

## Task 3.4: 添加条件边和循环到图

**Files:**
- Modify: `src/graph/index.ts`

- [ ] **Step 1: 重写图定义**

```typescript
import { StateGraph } from '@langchain/langgraph';
import { TutorState, type TutorStateType } from './state.js';
import { classifyNode } from './nodes/classify.js';
import { compressNode } from './nodes/compress.js';
import { buildPromptNode } from './nodes/build-prompt.js';
import { callLLMNode } from './nodes/call-llm.js';
import { executeToolsNode } from './nodes/execute-tools.js';
import { respondNode } from './nodes/respond.js';
import { MAX_TOOL_ITERATIONS } from '../config.js';

function routeAfterLLM(state: TutorStateType): 'executeTools' | 'respond' {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && 'tool_calls' in lastMessage && (lastMessage as any).tool_calls?.length) {
    return 'executeTools';
  }
  return 'respond';
}

function routeAfterTools(state: TutorStateType): 'callLLM' | 'respond' {
  if ((state.toolIterations ?? 0) >= MAX_TOOL_ITERATIONS) {
    console.log(`  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`);
    return 'respond';
  }
  return 'callLLM';
}

/**
 * Phase 3：完整图，含并行、条件边、工具循环。
 *
 * __start__ ──┬── classify  ──┬──→ buildPrompt ──→ callLLM ──→ conditional
 *             └── compress  ──┘         ▲                       │        │
 *                                       │                  tools?    no tools?
 *                                  executeTools ←──────────┘       respond
 *                                       │                            │
 *                                  conditional                   __end__
 *                                   │        │
 *                              continue   max reached → respond
 */
const workflow = new StateGraph(TutorState)
  .addNode('classify', classifyNode)
  .addNode('compress', compressNode)
  .addNode('buildPrompt', buildPromptNode)
  .addNode('callLLM', callLLMNode)
  .addNode('executeTools', executeToolsNode)
  .addNode('respond', respondNode)
  .addEdge('__start__', 'classify')
  .addEdge('__start__', 'compress')
  .addEdge('classify', 'buildPrompt')
  .addEdge('compress', 'buildPrompt')
  .addEdge('buildPrompt', 'callLLM')
  .addConditionalEdges('callLLM', routeAfterLLM, {
    executeTools: 'executeTools',
    respond: 'respond',
  })
  .addConditionalEdges('executeTools', routeAfterTools, {
    callLLM: 'callLLM',
    respond: 'respond',
  })
  .addEdge('respond', '__end__');

export const tutorGraph = workflow.compile();
```

- [ ] **Step 2: 验证编译 + 测试**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 3: 端到端验证工具循环**

启动服务，发送 VOCABULARY 场景消息（如 "What does resilient mean?"），观察日志确认：
- `[Tool] 调用函数: lookupWord(...)` 出现
- 工具结果返回后 LLM 再次被调用
- 最终返回包含字典数据的回复

- [ ] **Step 4: Commit**

```bash
git add src/graph/index.ts
git commit -m "feat(graph): add conditional edges and tool loop cycle (Phase 3 complete)"
```

---

## Task 3.5: Phase 3 掌控度自检

- [ ] 能解释 `callLLM → executeTools → callLLM` 循环的终止条件
- [ ] 能说出为什么 `messages` 字段需要 reducer 而 `reply` 不需要
- [ ] 能说出最大迭代次数在哪里控制（`routeAfterTools` + `MAX_TOOL_ITERATIONS`）
- [ ] 能解释手写 executeTools 和 LangGraph 预构建 `ToolNode` 的区别
- [ ] 所有现有测试通过 + 手动验证四种场景

---

# ═══════════════════════════════════════════════════════
# 迁移 Phase 4：Streaming 技术验证
# ═══════════════════════════════════════════════════════

> **学习目标：** graph.stream()、streamMode（values / updates）、streamEvents
>
> **完成标准：** 验证脚本运行成功，输出三种流模式的事件样本

---

## Task 4.1: 创建 Streaming 验证脚本

**Files:**
- Create: `src/graph/verify-streaming.ts`

- [ ] **Step 1: 创建验证脚本**

创建 `src/graph/verify-streaming.ts`：

```typescript
import { tutorGraph } from './index.js';
import { HumanMessage } from '@langchain/core/messages';

const testInput = {
  userMessage: 'What does "ephemeral" mean?',
  history: [],
  summary: '',
};

async function verifyValuesMode() {
  console.log('\n=== stream mode: values ===');
  console.log('每次输出完整的 State 快照\n');

  const stream = await tutorGraph.stream(testInput, { streamMode: 'values' });
  let count = 0;
  for await (const state of stream) {
    count++;
    console.log(`Snapshot #${count}: scenario=${state.scenario ?? 'N/A'}, reply=${(state.reply ?? '').slice(0, 50)}...`);
  }
  console.log(`Total snapshots: ${count}`);
}

async function verifyUpdatesMode() {
  console.log('\n=== stream mode: updates ===');
  console.log('每次只输出节点的增量更新\n');

  const stream = await tutorGraph.stream(testInput, { streamMode: 'updates' });
  for await (const update of stream) {
    const nodeNames = Object.keys(update);
    for (const name of nodeNames) {
      const fields = Object.keys(update[name]);
      console.log(`Node [${name}] updated fields: ${fields.join(', ')}`);
    }
  }
}

async function verifyStreamEvents() {
  console.log('\n=== streamEvents ===');
  console.log('逐 token 事件流（如果模型支持）\n');

  const stream = tutorGraph.streamEvents(testInput, { version: 'v2' });
  let tokenCount = 0;
  for await (const event of stream) {
    if (event.event === 'on_chat_model_stream') {
      const chunk = event.data?.chunk;
      if (chunk?.content) {
        tokenCount++;
        if (tokenCount <= 5) {
          process.stdout.write(chunk.content);
        }
      }
    }
  }
  console.log(`\n... total streaming tokens: ${tokenCount}`);
}

async function main() {
  console.log('LangGraph Streaming 技术验证');
  console.log('============================');

  await verifyValuesMode();
  await verifyUpdatesMode();
  await verifyStreamEvents();

  console.log('\n✅ Streaming 验证完成');
}

main().catch(console.error);
```

- [ ] **Step 2: 运行验证脚本**

```bash
npx tsx --env-file=.env src/graph/verify-streaming.ts
```

Expected: 三种模式均有输出。记录实际结果中的事件格式和粒度。

- [ ] **Step 3: 记录验证结果**

将验证结果写入 `docs/guides/2026-04-07-streaming-verification.md`（简短记录即可），包含：
- 三种模式是否成功
- 事件格式样本
- 是否支持 token 级流式（取决于 Moonshot 是否支持 SSE）
- 前端对接建议

- [ ] **Step 4: Commit**

```bash
git add src/graph/verify-streaming.ts docs/guides/2026-04-07-streaming-verification.md
git commit -m "feat(graph): add streaming verification script and results (Phase 4)"
```

---

## Task 4.2: Phase 4 掌控度自检

- [ ] 能说出 `stream("values")` 和 `stream("updates")` 分别返回什么
- [ ] 能说出 `streamEvents` 中 `on_chat_model_stream` 事件的数据结构
- [ ] 能画出 streaming 数据从 LLM → graph → Fastify → SSE → 前端的完整路径

---

# ═══════════════════════════════════════════════════════
# 收尾
# ═══════════════════════════════════════════════════════

## Task Final: 全量回归验证

- [ ] **Step 1: 运行全部测试**

```bash
npm test
cd web && npm test && cd ..
```

- [ ] **Step 2: 手动回归验证清单**

- [ ] VOCABULARY 场景：问一个单词，确认字典工具被调用且回复包含音标/释义
- [ ] GRAMMAR_CORRECTION 场景：输入语法错误的英文，确认纠正回复
- [ ] EXPRESSION 场景：用中文问「怎么说」，确认英文表达回复
- [ ] OFF_TOPIC 场景：问非英语学习问题，确认委婉拒绝
- [ ] 历史压缩：连续对话超过 10 轮，确认摘要生成
- [ ] 刷新恢复：刷新页面后历史消息仍在
- [ ] 重置：点"重新开始"后对话清空

- [ ] **Step 3: 更新产品路线图状态**

在 `docs/superpowers/specs/2026-04-07-langgraph-migration-design.md` §2.1 中，将「编排层：LangGraph 改造」标记为 ✅ 已完成。

- [ ] **Step 4: Final Commit**

```bash
git add -A
git commit -m "docs: mark LangGraph migration as complete in product roadmap"
```
