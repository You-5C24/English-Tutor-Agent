/**
 * 核心对话入口 — LangGraph `tutorGraph.invoke()` 的薄包装。
 *
 * Phase 1：编排（分类、压缩、组 prompt、工具循环、收尾）均在 `src/graph/` 中完成；
 * 本文件只负责：
 * 1. 将 `Session` 转成图的输入字段（history 需先转为 `BaseMessage[]`）
 * 2. 调用 `tutorGraph.invoke()`
 * 3. 把图输出的压缩历史与摘要写回 `Session`，并追加本轮 user / assistant
 *
 * `preloadRagKnowledge` 仍负责异步初始化 Chroma；须调用 `setChromaReadyState`，
 * 否则 `buildPromptNode` 里的 `isChromaReady()` 恒为 false，RAG 不会注入。
 */
import { tutorGraph } from '@/graph/index';
import {
  sessionHistoryToBaseMessages,
  baseMessagesToSessionHistory,
} from '@/graph/adapters';
import {
  initChromaRag,
  setChromaReadyState,
} from '@/rag/chroma-store';
import { Session, ChatResult } from '@/types/session';

let chromaInitPromise: Promise<void> | undefined;

/**
 * 预加载：连接 Chroma 并灌库（首次启动时调用，避免首条消息阻塞）。
 * 未配置 CHROMA_URL 时直接返回，对话不依赖 RAG。
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

export async function chat(
  session: Session,
  userMessage: string
): Promise<ChatResult> {
  const result = await tutorGraph.invoke({
    userMessage,
    history: sessionHistoryToBaseMessages(session.history),
    summary: session.summary,
  });

  session.history = baseMessagesToSessionHistory(
    result.compressedHistory ?? []
  );
  session.summary = result.compressedSummary ?? '';
  session.history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: result.reply }
  );

  return { reply: result.reply, scenario: result.scenario };
}
