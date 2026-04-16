import { END, START, StateGraph } from '@langchain/langgraph';
import { TutorState } from './state.js';
import { classifyNode } from './nodes/classify.js';
import { compressNode } from './nodes/compress.js';
import { buildPromptNode } from './nodes/build-prompt.js';
import { callLLMNode } from './nodes/call-llm.js';
import { respondNode } from './nodes/respond.js';

/**
 * Phase 2：并行 fan-out (classify + compress) → fan-in (buildPrompt)。
 *
 * START ──→ classify  ──→ buildPrompt ──→ callLLM ──→ respond ──→ END
 * START ──→ compress  ──→ buildPrompt
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
  .addEdge(START, 'classify')
  .addEdge(START, 'compress')
  // fan-in：两者都完成后才进入 buildPrompt
  .addEdge('classify', 'buildPrompt')
  .addEdge('compress', 'buildPrompt')
  // 线性
  .addEdge('buildPrompt', 'callLLM')
  .addEdge('callLLM', 'respond')
  .addEdge('respond', END);

/** 编译后的可执行图；服务层通过 invoke / stream 驱动 */
export const tutorGraph = workflow.compile();
