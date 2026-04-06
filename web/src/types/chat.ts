export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  scenario?: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: string;
  scenario: string;
}

export interface HistoryResponse {
  messages: Message[];
}

export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}
