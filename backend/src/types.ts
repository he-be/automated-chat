export interface ChatMessage {
  speaker: 'ALVA' | 'Bob' | 'System';
  text: string;
  timestamp: Date;
}

export interface LLMResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export type ModelType = 'openai' | 'gemini' | 'dummy' | 'ollama';
