# Streaming spike 笔记（Task 1）

> 来源：`npx tsx --env-file=.env src/graph/verify-streaming.ts`（与 plan Task 1 Step 2 对齐）

## 1. Root `on_chain_end` 能否一次拿齐 done 所需字段

**可以。** 本次 run 中 root（`name === 'LangGraph'`）的 `data.output` 包含：

`userMessage`, `scenario`, `history`, `summary`, `compressedHistory`, `compressedSummary`, `systemPrompt`, `fewShot`, `hasTools`, `messages`, `toolIterations`, `reply`

因此 **`scenario` / `reply` / `compressedHistory` / `compressedSummary` 均可直接从 root 读取**，无需仅依赖节点级聚合。节点级 `on_chain_end` 仍可作为对照或兜底：

| 节点名       | `output` keys（本次观测）                    |
|-------------|-----------------------------------------------|
| `compress`  | `compressedHistory`, `compressedSummary`    |
| `classify`  | `scenario`                                    |
| `respond`   | `reply`                                       |

后续 `chatStream()` 字段策略：**优先消费 root 最终 `on_chain_end`**；若将来版本 root 形状变化，再回退到上表节点级拼装。

## 2. `streamEvents` + `AbortSignal`

- **能否中止：** 能。`controller.abort()` 后迭代结束。
- **错误类型：** `AbortError`（`err.name === 'AbortError'`）。
- **触发条件（脚本内）：** 在 `on_chat_model_stream` 上出现且总事件数 `eventCount > 2` 时调用 `abort()`。

## 3. Abort 时延（调参参考）

- 脚本**未打时间戳**；从行为上看，`abort()` 后**当次迭代即退出**，无额外完整图跑完的现象。
- 本次端到端脚本 wall time 约 **50s**（含 values / updates / streamEvents / 两项核查）；abort 探针位于**最后一次** `streamEvents` 消费中，在用户体感上属于「流已开始后很快可停」。
- **建议：** 若产品上要标「停止」SLA，应在 `chat-stream-service` 或路由层补一次计时的集成测试；本 spike 仅证明 **signal 被尊重且错误类型为 `AbortError`**。

## 4. 与 plan 的衔接

- Task 3+ 事件映射与持久化：**以本笔记 root 形状为准**；spec 中「节点级聚合」仍成立且更稳健，但当前图 **root 已足够**。
- Plan 中「post-Task 1 mock 下沉」待办：在 Task 15 回归时按 plan 勾选。
