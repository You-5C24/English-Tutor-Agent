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
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { chatModel, summaryModel } from '@/llm/model';
import { toBaseMessages, fromAIMessage } from '@/llm/model-helpers';
import { classify, Scenario } from '@/classifier';
import { baseSystemPrompt } from '@/prompts/base';
import { vocabularyCot, vocabularyFewShot } from '@/prompts/vocabulary';
import { grammarCot, grammarFewShot } from '@/prompts/grammar';
import { expressionCot, expressionFewShot } from '@/prompts/expression';
import { offTopicCot } from '@/prompts/offTopic';
import { formatRagContext } from '@/prompts/rag';
import {
  initChromaRag,
  isChromaReady,
  retrieveFromChroma,
  setChromaReadyState,
} from '@/rag/chroma-store';
import { dictionaryTool } from '@/tools/dictionary';
import {
  CHAT_MODEL,
  COMPRESS_THRESHOLD,
  KEEP_RECENT_ROUNDS,
  RAG_TOP_K,
  RAG_MIN_SCORE,
  MAX_TOOL_ITERATIONS,
  SUMMARY_MAX_TOKENS,
} from '@/config';
import { Session, ChatResult } from '@/types/session';
import { ChatCompletionMessageParam } from 'openai/resources';

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
        setChromaReadyState(ok);
        console.log(
          ok
            ? '  [RAG] Chroma 已就绪'
            : '  [RAG] Chroma 初始化失败，本次不使用 RAG'
        );
      })
      .catch((err) => {
        setChromaReadyState(false);
        console.warn('  [RAG] Chroma 连接异常，本次不使用 RAG:', err);
      });
  }
  await chromaInitPromise;
}

/** 打印当前上下文状态面板，方便调试时直观观察压缩效果 */
function logContextStatus(
  label: string,
  messageCount?: number,
  session?: Session
) {
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

  const response = await summaryModel.invoke([
    new SystemMessage(
      '你是一个对话摘要助手。请用简洁的中文总结对话内容，保留关键学习点和用户水平信息。'
    ),
    new HumanMessage(summaryPrompt),
  ]);

  return fromAIMessage(response).trim();
}

/**
 * 摘要压缩的核心调度函数。
 *
 * 触发条件：session.history 的轮数 > COMPRESS_THRESHOLD（10 轮）
 * 执行逻辑：
 *   1. 将历史分为两部分：早期消息（要压缩的）和近期消息（要保留的）
 *   2. 调用 generateSummary 将早期消息（连同旧摘要）压缩为新摘要
 *   3. 用近期消息替换 session.history，更新 session.summary
 */
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

  if (scenario !== 'OFF_TOPIC' && isChromaReady()) {
    try {
      const top = (await retrieveFromChroma(userMessage, RAG_TOP_K)).filter(
        (t) => t.score >= RAG_MIN_SCORE
      );
      if (top.length > 0) {
        systemPrompt += '\n\n' + formatRagContext(top);
        console.log(
          `  [RAG] 已注入 ${top.length} 条（分数: ${top
            .map((t) => t.score.toFixed(3))
            .join(', ')})`
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
 */
async function runToolLoop(
  messages: ChatCompletionMessageParam[],
  useTools: boolean
): Promise<string> {
  const loopMessages: BaseMessage[] = toBaseMessages(messages);
  let reply = '';
  let iterations = 0;

  const model = useTools ? chatModel.bindTools([dictionaryTool]) : chatModel;

  while (true) {
    iterations++;
    if (iterations > MAX_TOOL_ITERATIONS) {
      console.log(
        `  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`
      );
      break;
    }

    const response = await model.invoke(loopMessages);
    loopMessages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        console.log(
          `  [Tool] 调用函数: ${toolCall.name}(${JSON.stringify(
            toolCall.args
          )})`
        );

        const toolResult = await dictionaryTool.invoke(toolCall.args);

        console.log(
          `  [Tool] 执行结果: ${toolResult.slice(0, 100)}${
            toolResult.length > 100 ? '...' : ''
          }`
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

export async function chat(
  session: Session,
  userMessage: string
): Promise<ChatResult> {
  const [scenario] = await Promise.all([
    classify(userMessage),
    compressHistory(session),
  ]);
  console.log(`  [Router] Detected scenario: ${scenario}`);

  const { cot, fewShot } = scenarioConfig[scenario];
  const systemPrompt = await buildSystemPrompt(
    scenario,
    cot,
    session.summary,
    userMessage
  );

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
