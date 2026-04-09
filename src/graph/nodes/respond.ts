import type { TutorStateType } from '@/graph/state';

type RespondNodeResult = {
  reply: string;
};

/**
 * 图的收尾节点：对外只关心最终 `reply`。
 *
 * - 正常路径：`callLLMNode` 已写入 `reply`，直接透传。
 * - 兜底：`reply` 仍为空时（例如异常边界），从 `messages` 里倒序找最近一条带非空字符串内容的 AI 消息；
 *   找不到则返回固定提示，避免前端拿到空串。
 */
export async function respondNode(
  state: TutorStateType
): Promise<RespondNodeResult> {
  if (state.reply) {
    return { reply: state.reply };
  }

  const lastAI = [...state.messages]
    .reverse()
    .find(
      (m) =>
        m.type === 'ai' &&
        m.content &&
        typeof m.content === 'string' &&
        m.content.length > 0
    );

  const fallback = lastAI
    ? (lastAI.content as string)
    : '抱歉，我暂时无法完成查询，请稍后再试。';

  return { reply: fallback };
}
