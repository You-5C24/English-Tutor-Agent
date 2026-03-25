/**
 * 核心对话函数 — Agent 的"调度中心"
 *
 * 这个文件是整个英语私教 Agent 最关键的部分，它做五件事：
 * 1. 路由：调用 classifier 判断用户意图
 * 2. 动态组装：根据场景只注入对应的 CoT + Few-shot（而不是全量注入，节省约 56% token）
 * 3. 上下文管理：用"摘要"压缩策略控制对话历史长度，防止 token 无限增长
 * 4. Function Calling：VOCABULARY 场景下注入字典工具，让 LLM 能主动查询真实词典
 * 5. RAG：非 OFF_TOPIC 场景下从 Docker Chroma 检索 Top-K 知识点并注入 system（需 CHROMA_URL 且容器在跑）
 *
 * 上下文压缩策略 — 摘要总结：
 *   当对话轮数超过阈值（COMPRESS_THRESHOLD）时，将较早的对话用 LLM 压缩成 1-2 句摘要，
 *   仅保留最近 KEEP_RECENT_ROUNDS 轮原始对话。摘要作为 system 消息注入，
 *   让模型既能感知长期上下文，又不会因为 token 过多而降低质量或超限。
 *
 * 每次用户发消息的 LLM 调用次数：
 *   第 1 次：classifier.ts 中的 classify()，轻量分类（~100 tokens）
 *   第 2 次：chat() 主调用；VOCABULARY 场景若触发工具则会有第 3 次（基于 API 数据生成回复）
 *   （触发压缩时额外 +1 次：generateSummary() 生成摘要）
 */
import { ChatCompletionMessageParam } from 'openai/resources';
import { client } from './client.js';
import { classify, Scenario } from './classifier.js';
import { baseSystemPrompt } from './prompts/base.js';
import { vocabularyCot, vocabularyFewShot } from './prompts/vocabulary.js';
import { grammarCot, grammarFewShot } from './prompts/grammar.js';
import { expressionCot, expressionFewShot } from './prompts/expression.js';
import { offTopicCot } from './prompts/offTopic.js';
import { formatRagContext } from './prompts/rag.js';
import { initChromaRag, retrieveFromChroma } from './rag/chroma-store.js';
// 步骤 8：导入字典工具 — dictionaryTool 是给 LLM 看的"菜单"，executeToolCall 是实际执行器
import { dictionaryTool, executeToolCall } from './tools/dictionary.js';
import {
  CHAT_MODEL,
  COMPRESS_THRESHOLD,
  KEEP_RECENT_ROUNDS,
  RAG_TOP_K,
  RAG_MIN_SCORE,
  MAX_TOOL_ITERATIONS,
  SUMMARY_MAX_TOKENS,
} from './config.js';

/**
 * 场景配置表：每个场景对应一套 CoT（思维链）和 Few-shot（示范对话）。
 * 新增场景只需：1) 在 prompts/ 下加文件  2) 在这里注册一行  3) 在 classifier 中加分类描述
 */
const scenarioConfig: Record<
  Scenario,
  { cot: string; fewShot: ChatCompletionMessageParam[] }
> = {
  VOCABULARY: { cot: vocabularyCot, fewShot: vocabularyFewShot },
  GRAMMAR_CORRECTION: { cot: grammarCot, fewShot: grammarFewShot },
  EXPRESSION: { cot: expressionCot, fewShot: expressionFewShot },
  OFF_TOPIC: { cot: offTopicCot, fewShot: [] },
};

/**
 * 对话历史（只存用户真实对话，不含 system prompt 和 few-shot）。
 * 这样设计是因为 system prompt 和 few-shot 会根据每次的场景动态切换，
 * 而对话历史需要跨场景保持连续。
 */
let conversationHistory: ChatCompletionMessageParam[] = [];

/**
 * 历史摘要：存储被压缩的早期对话的 LLM 摘要。
 * 每次触发压缩时，旧摘要会和新的早期对话一起被重新总结，
 * 保证摘要始终是对全部历史的完整概括。
 */
let summaryContext = '';

/** Chroma RAG 是否已初始化（undefined = 未尝试，true/false = 结果） */
let chromaReady: boolean | undefined;
let chromaInitPromise: Promise<void> | undefined;

/**
 * 预加载：连接 Chroma 并灌库（首次启动时调用，避免第一条消息等待）
 * CHROMA_URL 未设置时静默跳过，Agent 正常工作，不使用 RAG
 */
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

/** 打印当前上下文状态面板，方便调试时直观观察压缩效果 */
function logContextStatus(label: string, messageCount?: number) {
  const rounds = conversationHistory.length / 2;
  const summaryStatus = summaryContext
    ? `"${summaryContext.slice(0, 60)}${
        summaryContext.length > 60 ? '...' : ''
      }"`
    : '无';
  const lines = [
    `│  历史轮数:    ${rounds} 轮 (${conversationHistory.length} 条消息)`,
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

/**
 * 调用 LLM 将对话消息列表压缩为 1-2 句话的摘要。
 * 如果已有旧摘要（previousSummary），会一并提供给 LLM，让它在旧摘要基础上做增量总结，
 * 这样即使经过多次压缩，摘要也能覆盖完整的对话历史。
 */
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

  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          '你是一个对话摘要助手。请用简洁的中文总结对话内容，保留关键学习点和用户水平信息。',
      },
      { role: 'user', content: summaryPrompt },
    ],
    max_completion_tokens: SUMMARY_MAX_TOKENS,
    // @ts-expect-error kimi-k2.5 扩展参数，关闭思考模式以节省 token（摘要任务无需深度推理）
    thinking: { type: 'disabled' },
  });

  return completion.choices[0].message.content?.trim() ?? '';
}

/**
 * 摘要压缩的核心调度函数。
 *
 * 触发条件：conversationHistory 的轮数 > COMPRESS_THRESHOLD（10 轮）
 * 执行逻辑：
 *   1. 将历史分为两部分：早期消息（要压缩的）和近期消息（要保留的）
 *   2. 调用 generateSummary 将早期消息（连同旧摘要）压缩为新摘要
 *   3. 用近期消息替换 conversationHistory，更新 summaryContext
 *
 * 压缩后的效果：conversationHistory 从 20+ 条消息缩减为 10 条，
 * 被丢弃的早期消息以摘要形式保存在 summaryContext 中。
 */
async function compressHistory(): Promise<void> {
  const totalRounds = conversationHistory.length / 2;
  if (totalRounds < COMPRESS_THRESHOLD) return;

  logContextStatus('压缩前 (Before Compression)');
  console.log(
    `  ⚡ [Memory] 触发压缩! ${totalRounds} 轮 > 阈值 ${COMPRESS_THRESHOLD} 轮，正在生成摘要...`
  );

  const keepMessages = KEEP_RECENT_ROUNDS * 2;
  const oldMessages = conversationHistory.slice(0, -keepMessages);
  const recentMessages = conversationHistory.slice(-keepMessages);

  const newSummary = await generateSummary(oldMessages, summaryContext);
  console.log(`  [Memory] 被压缩的消息数: ${oldMessages.length} 条`);
  console.log(`  [Memory] LLM 返回的摘要: "${newSummary}"`);

  summaryContext = newSummary;
  conversationHistory = recentMessages;

  logContextStatus('压缩后 (After Compression)');
}

/**
 * 动态组装 system prompt：基础 prompt + 场景 CoT + 历史摘要 + RAG 检索结果注入。
 * RAG 结果低于 RAG_MIN_SCORE 的条目会被过滤，避免注入低质量上下文。
 */
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

  // RAG：非闲聊场景且 Chroma 已就绪时，检索 Top-K 知识点并过滤低分结果后注入 system
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
 * Tool Use Loop：持续调用 LLM，直到收到文字回复（无 tool_calls）或达到最大迭代次数。
 *
 * 为什么需要循环？
 * 当 LLM 想用工具时，它不会直接返回文字，而是返回一个 tool_calls 请求。
 * 我们执行完工具，把结果传回去，LLM 才会用数据生成最终的文字回复。
 * 这个"LLM → 工具 → LLM"的往返可能发生多次，所以需要循环处理。
 */
async function runToolLoop(
  messages: ChatCompletionMessageParam[],
  tools: typeof dictionaryTool[] | undefined
): Promise<string> {
  // loopMessages 是循环内部用的消息队列，会随每次 tool 调用不断追加新消息。
  // 使用独立副本，避免污染 conversationHistory（历史里不需要记录 tool 的中间过程）。
  const loopMessages: ChatCompletionMessageParam[] = [...messages];
  let reply = '';
  let iterations = 0;

  while (true) {
    iterations++;

    // 安全边界：超过最大迭代次数时强制跳出，防止极端情况下的无限循环
    if (iterations > MAX_TOOL_ITERATIONS) {
      console.log(
        `  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`
      );
      break;
    }

    // 调用 LLM — 传入 tools 时，LLM 可能返回 tool_calls（工具请求）而非 content（文字回复）
    const completion = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: loopMessages,
      tools,
    });

    const message = completion.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      // ── 分支 A：LLM 决定要调用工具 ──
      // 把这条包含 tool_calls 的 assistant 消息追加进去，
      // 这一步是必须的，否则后续追加 tool 结果时 LLM 会找不到对应的 tool_call_id
      loopMessages.push(message as ChatCompletionMessageParam);

      // 遍历本次 LLM 请求的所有工具调用（通常只有 1 个，但 API 支持并发多个）
      // 用 .filter(tc => tc.type === 'function') 缩窄类型：OpenAI SDK 的 tool_calls 是联合类型
      // （标准 function call 和 custom tool call），过滤后才能安全访问 .function 属性
      for (const toolCall of message.tool_calls.filter(
        (tc) => tc.type === 'function'
      )) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments) as Record<
          string,
          unknown
        >;

        console.log(
          `  [Tool] 调用函数: ${functionName}(${toolCall.function.arguments})`
        );

        // 实际执行工具函数（如查字典 API）
        const toolResult = await executeToolCall(functionName, args);

        // 只打印前 100 个字符，避免长数据刷屏
        console.log(
          `  [Tool] 执行结果: ${toolResult.slice(0, 100)}${
            toolResult.length > 100 ? '...' : ''
          }`
        );

        // 把工具执行结果作为 role: "tool" 消息追加到队列。
        // tool_call_id 必须与 LLM 请求中的 id 对应，LLM 靠这个 id 知道哪个结果对应哪个请求。
        loopMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }

      // 本轮有工具调用，继续循环让 LLM 基于工具结果生成回复
      continue;
    }

    // ── 分支 B：LLM 没有工具调用，返回了最终文字回复 ──
    reply = message.content ?? '';
    break;
  }

  return reply;
}

export async function chat(userMessage: string): Promise<string> {
  // —— 第 1-2 步：路由 + 摘要压缩（并行执行，互不依赖）——
  const [scenario] = await Promise.all([classify(userMessage), compressHistory()]);
  console.log(`  [Router] Detected scenario: ${scenario}`);

  // —— 第 3 步：动态组装 Prompt ——
  const { cot, fewShot } = scenarioConfig[scenario];
  const systemPrompt = await buildSystemPrompt(scenario, cot, summaryContext, userMessage);

  /**
   * 最终发给 LLM 的 messages 数组结构：
   * [0]     system     — baseSystemPrompt + 当前场景 CoT + 历史摘要（如有）+ RAG 知识点（如有）
   * [1-2]   user+asst  — 当前场景的 Few-shot 示范（OFF_TOPIC 时为空）
   * [3..N]  user+asst  — 压缩后保留的近期对话历史
   * [N+1]   user       — 本次用户输入
   */
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...fewShot,
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  logContextStatus(
    `第 ${conversationHistory.length / 2 + 1} 轮对话`,
    messages.length
  );

  // —— 第 4 步：决定是否注入 tools 参数 ——
  // 只有 VOCABULARY 场景才传入字典工具；其他场景传 undefined，行为与改造前完全一致。
  const tools = scenario === 'VOCABULARY' ? [dictionaryTool] : undefined;

  // —— 第 5 步：Tool Use Loop（第 2 次起的 LLM 调用）——
  const reply = await runToolLoop(messages, tools);

  // —— 第 6 步：更新对话历史 ——
  // 只保存 user 和最终 assistant 的文字回复，tool 调用的中间过程不存入历史。
  conversationHistory.push({ role: 'user', content: userMessage });
  conversationHistory.push({ role: 'assistant', content: reply });

  return reply;
}
