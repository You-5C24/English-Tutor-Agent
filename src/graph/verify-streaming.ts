/**
 * Phase 4：手动验证 tutorGraph 的三种流式 API。
 * 运行：npx tsx --env-file=.env src/graph/verify-streaming.ts
 */
import { tutorGraph } from './index.js';

/** 与 TutorState 对齐的最小输入；其余字段由各节点在运行中填充 */
const testInput = {
  userMessage: 'What does "ephemeral" mean?',
  history: [],
  summary: '',
};

/** streamMode: values —— 每步推送完整 state 快照，适合 UI 全量刷新 */
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

/** streamMode: updates —— 每步仅推送本节点写入的字段，适合增量合并 */
async function verifyUpdatesMode() {
  console.log('\n=== stream mode: updates ===');
  console.log('每次只输出节点的增量更新\n');

  const stream = await tutorGraph.stream(testInput, { streamMode: 'updates' });
  for await (const update of stream) {
    // Object.entries：在严格 TS 下安全遍历节点名 → 节点增量 payload
    for (const [name, nodePayload] of Object.entries(update)) {
      if (nodePayload && typeof nodePayload === 'object') {
        const fields = Object.keys(nodePayload);
        console.log(`Node [${name}] updated fields: ${fields.join(', ')}`);
      }
    }
  }
}

/** LangGraph streamEvents：底层事件；此处只统计 on_chat_model_stream 以观察 token 级输出 */
async function verifyStreamEvents() {
  console.log('\n=== streamEvents ===');
  console.log('逐 token 事件流（如果模型支持）\n');

  // v2 为当前 LangGraph 推荐的事件 schema
  const stream = tutorGraph.streamEvents(testInput, { version: 'v2' });
  let tokenCount = 0;
  for await (const event of stream) {
    if (event.event === 'on_chat_model_stream') {
      const chunk = event.data?.chunk;
      if (chunk?.content) {
        tokenCount++;
        // 控制台只打印前几个 token，避免刷屏；总数见结尾日志
        if (tokenCount <= 5) {
          process.stdout.write(chunk.content);
        }
      }
    }
  }
  console.log(`\n... total streaming tokens: ${tokenCount}`);
}

/** 核查 A：节点级 on_chain_end 是否带齐 chatStream 持久化所需的字段 */
async function verifyFinalStateFromEvents() {
  console.log('\n=== 核查：节点级 on_chain_end 能否凑齐最终 state ===');
  const stream = tutorGraph.streamEvents(testInput, { version: 'v2' });
  const captured: Record<string, unknown> = {};
  for await (const event of stream) {
    if (event.event === 'on_chain_end') {
      const name = event.name;
      if (['classify', 'compress', 'respond', 'LangGraph'].includes(name)) {
        captured[name] = event.data?.output;
        console.log(`  [on_chain_end] ${name}:`, Object.keys((event.data?.output ?? {}) as object));
      }
    }
  }
  const root = captured['LangGraph'] as Record<string, unknown> | undefined;
  console.log('\n  root output keys:', root ? Object.keys(root) : '(missing)');
  console.log('  结论提示：chatStream() 可直接从以下来源组装 done 事件字段');
  console.log('    - scenario:           classify.output.scenario 或 root.scenario');
  console.log('    - reply:              respond.output.reply 或 root.reply');
  console.log('    - compressedHistory:  compress.output.compressedHistory 或 root.compressedHistory');
  console.log('    - compressedSummary:  compress.output.compressedSummary 或 root.compressedSummary');
}

/** 核查 B：向 streamEvents 传入 AbortSignal 是否能让其尽快中止并抛 AbortError */
async function verifyAbortSignalPropagation() {
  console.log('\n=== 核查：AbortSignal 是否被 streamEvents 尊重 ===');
  const controller = new AbortController();
  const stream = tutorGraph.streamEvents(testInput, {
    version: 'v2',
    signal: controller.signal,
  });
  let eventCount = 0;
  try {
    for await (const event of stream) {
      eventCount++;
      if (event.event === 'on_chat_model_stream' && eventCount > 2) {
        console.log('  触发 abort...');
        controller.abort();
      }
    }
    console.log(`  [WARN] 迭代自然结束（共 ${eventCount} 个事件），未抛 AbortError`);
  } catch (err) {
    const name = (err as Error).name;
    console.log(`  ✓ 迭代终止，抛错类型：${name}`);
  }
}

async function main() {
  console.log('LangGraph Streaming 技术验证');
  console.log('============================');

  await verifyValuesMode();
  await verifyUpdatesMode();
  await verifyStreamEvents();
  await verifyFinalStateFromEvents();
  await verifyAbortSignalPropagation();

  console.log('\n✅ Streaming 验证完成');
}

main().catch(console.error);
