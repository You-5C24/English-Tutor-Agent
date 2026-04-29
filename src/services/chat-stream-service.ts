import { randomUUID } from 'node:crypto';
import type { BaseMessage } from '@langchain/core/messages';
import { tutorGraph } from '@/graph/index';
import { sessionHistoryToBaseMessages, baseMessagesToSessionHistory } from '@/graph/adapters';
import { runTransaction } from '@/db/database';
import * as messageRepo from '@/db/message-repo';
import * as sessionManager from '@/services/session-manager';
import type { Session } from '@/types/session';
import type { Scenario } from '@/classifier';
import type { StreamEvent } from '@/services/sse-protocol';

interface CollectedState {
  scenario?: Scenario;
  reply: string;
  compressedHistory?: unknown[];
  compressedSummary?: string;
}

function newMessageId(): string {
  return randomUUID();
}

/**
 * 把 LangGraph streamEvents 映射为 Phase 4 的 StreamEvent 序列，并在图正常结束后
 * 一次性在事务中落库（与现有 chat() 语义等价）。
 *
 * 不变量：
 * - 正常路径：meta(可选) → token* → done
 * - 合法中止：不 yield 终态帧、不更新 session、不落库（静默结束）
 * - 失败：yield error（LLM_ERROR / INTERNAL），且不落库
 */
export async function* chatStream(
  session: Session,
  userMessage: string,
  signal: AbortSignal
): AsyncIterable<StreamEvent> {
  const input = {
    userMessage,
    history: sessionHistoryToBaseMessages(session.history),
    summary: session.summary,
  };

  const collected: CollectedState = { reply: '' };
  let metaEmitted = false;

  const stream = tutorGraph.streamEvents(input, { version: 'v2', signal });

  // 仅映射 LangGraph 事件流；持久化与 yield done 放在 try 外，保证仅在 for-await 正常结束时执行。
  try {
    for await (const event of stream as AsyncIterable<{
      event: string;
      name?: string;
      data?: { chunk?: { content?: unknown }; output?: Record<string, unknown> };
    }>) {
      if (event.event === 'on_chat_model_stream') {
        const raw = event.data?.chunk?.content;
        const delta = typeof raw === 'string' ? raw : '';
        if (delta.length > 0) {
          collected.reply += delta;
          yield { type: 'token', delta };
        }
      } else if (event.event === 'on_chain_end') {
        const out = event.data?.output ?? {};
        if (event.name === 'classify' && !metaEmitted) {
          const scenario = out.scenario as Scenario | undefined;
          if (scenario) {
            collected.scenario = scenario;
            metaEmitted = true;
            yield { type: 'meta', scenario };
          }
        } else if (event.name === 'compress') {
          collected.compressedHistory = out.compressedHistory as unknown[] | undefined;
          collected.compressedSummary = out.compressedSummary as string | undefined;
        } else if (event.name === 'respond') {
          const finalReply = out.reply as string | undefined;
          if (typeof finalReply === 'string' && finalReply.length > 0) {
            collected.reply = finalReply;
          }
        }
      }
    }
  } catch (err) {
    const e = err as Error;
    // 主判据：调用方持有的 signal 已中止（兼容底层具体错误类型）。
    // 次判据：底层显式 AbortError（例如 signal 未挂上但迭代器自行中止）。
    if (signal.aborted || e.name === 'AbortError') {
      return; // 合法中止：不 yield 终态帧、不落库
    }

    // 分类策略（对齐 spec §7）：
    // - 图/LLM 链内冒出的错误 → 默认 LLM_ERROR（含实作上由工具节点抛出的情况，暂合并为同码）
    // - 明显为 JS 编程错误 → INTERNAL
    const code: 'LLM_ERROR' | 'INTERNAL' =
      e.name === 'TypeError' || e.name === 'ReferenceError' ? 'INTERNAL' : 'LLM_ERROR';

    yield {
      type: 'error',
      code,
      message: e.message ?? 'upstream failure',
    };
    return;
  }

  // for-await 正常结束（图跑完）；合法中止不会到达此处。
  session.history = baseMessagesToSessionHistory(
    (collected.compressedHistory ?? []) as BaseMessage[]
  );
  session.summary = collected.compressedSummary ?? '';
  session.history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: collected.reply }
  );

  const userMessageId = newMessageId();
  const assistantMessageId = newMessageId();
  const now = Date.now();
  runTransaction(() => {
    sessionManager.save();
    messageRepo.addMessage({
      id: userMessageId,
      role: 'user',
      content: userMessage,
      scenario: null,
      timestamp: now - 1,
    });
    messageRepo.addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: collected.reply,
      scenario: collected.scenario ?? null,
      timestamp: now,
    });
  });

  yield {
    type: 'done',
    messageId: assistantMessageId,
    scenario: (collected.scenario ?? 'OFF_TOPIC') as Scenario,
    replyLength: collected.reply.length,
  };
}
