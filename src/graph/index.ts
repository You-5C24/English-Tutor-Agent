import { END, START, StateGraph } from '@langchain/langgraph';
import { TutorState } from './state.js';
import { classifyNode } from './nodes/classify.js';
import { compressNode } from './nodes/compress.js';
import { buildPromptNode } from './nodes/build-prompt.js';
import { callLLMNode } from './nodes/call-llm.js';
import { respondNode } from './nodes/respond.js';

/**
 * Phase 1：线性编排，与旧版 chat() 顺序一致。
 * classify → compress → buildPrompt → callLLM → respond
 *
 * 使用 SDK 提供的 START / END 常量，等价于 "__start__" / "__end__"，便于类型提示与后续升级。
 */
const workflow = new StateGraph(TutorState)
  .addNode('classify', classifyNode)
  .addNode('compress', compressNode)
  .addNode('buildPrompt', buildPromptNode)
  .addNode('callLLM', callLLMNode)
  .addNode('respond', respondNode)
  .addEdge(START, 'classify')
  .addEdge('classify', 'compress')
  .addEdge('compress', 'buildPrompt')
  .addEdge('buildPrompt', 'callLLM')
  .addEdge('callLLM', 'respond')
  .addEdge('respond', END);

/** 编译后的可执行图；服务层通过 invoke / stream 驱动 */
export const tutorGraph = workflow.compile();
