export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  scenario?: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  scenario: string;
}

export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}
