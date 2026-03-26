import { ChatCompletionMessageParam } from 'openai/resources';
import { Scenario } from '../classifier.js';

export interface Session {
  id: string;
  history: ChatCompletionMessageParam[];
  summary: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface ChatResult {
  reply: string;
  scenario: Scenario;
}
