import type { AIMessage } from '@langchain/core/messages';
import { END, START, StateGraph } from '@langchain/langgraph';
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
  if (lastMessage?.type === 'ai') {
    const toolCalls = (lastMessage as AIMessage).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      return 'executeTools';
    }
  }
  return 'respond';
}

function routeAfterTools(state: TutorStateType): 'callLLM' | 'respond' {
  if ((state.toolIterations ?? 0) >= MAX_TOOL_ITERATIONS) {
    console.log(
      `  [Tool] 已达最大迭代次数 (${MAX_TOOL_ITERATIONS})，强制结束循环`
    );
    return 'respond';
  }
  return 'callLLM';
}

/**
 * Phase 3：完整图，含并行、条件边、工具循环。
 *
 * START ──┬── classify  ──┬──→ buildPrompt ──→ callLLM ──→ conditional
 *         └── compress  ──┘         ▲                       │        │
 *                                   │                  tools?    no tools?
 *                              executeTools ←──────────┘       respond
 *                                   │                            │
 *                              conditional                   END
 *                               │        │
 *                          continue   max reached → respond
 */
const workflow = new StateGraph(TutorState)
  .addNode('classify', classifyNode)
  .addNode('compress', compressNode)
  .addNode('buildPrompt', buildPromptNode)
  .addNode('callLLM', callLLMNode)
  .addNode('executeTools', executeToolsNode)
  .addNode('respond', respondNode)
  .addEdge(START, 'classify')
  .addEdge(START, 'compress')
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
  .addEdge('respond', END);

/** 编译后的可执行图；服务层通过 invoke / stream 驱动 */
export const tutorGraph = workflow.compile();
