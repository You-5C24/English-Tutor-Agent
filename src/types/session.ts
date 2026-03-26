/**
 * 全局类型定义 — 整个 Web API 的数据契约
 *
 * Session 是从 CLI 到 Web API 改造的核心概念：
 * 原来 chat.ts 用模块级变量存对话状态（单用户），现在每个用户有独立的 Session 对象。
 * ChatResult 是 ChatService 的返回类型，同时供路由层构造 HTTP 响应。
 */
import { ChatCompletionMessageParam } from 'openai/resources';
import { Scenario } from '../classifier.js';

/**
 * 用户会话 — 每个用户/每次对话一个实例
 *
 * 等价于原 chat.ts 中的模块级变量 conversationHistory + summaryContext，
 * 但现在是独立对象，多用户之间互不干扰。
 */
export interface Session {
  id: string;                              // 唯一标识，前缀 s_ 便于识别（如 "s_a1b2c3..."）
  history: ChatCompletionMessageParam[];   // 对话历史（原 conversationHistory）
  summary: string;                         // 历史摘要（原 summaryContext），压缩时生成
  createdAt: number;                       // 创建时间戳
  lastActiveAt: number;                    // 最后活跃时间戳，用于 TTL 过期判断
}

/**
 * ChatService.chat() 的返回类型
 *
 * 返回结构体而非裸字符串，这样路由层可以直接将 scenario 传给前端，
 * 无需在路由层重复调用 classify()（那样会浪费一次 LLM 调用）。
 */
export interface ChatResult {
  reply: string;       // LLM 生成的回复文本
  scenario: Scenario;  // 本次命中的教学场景（VOCABULARY / GRAMMAR_CORRECTION / ...）
}
