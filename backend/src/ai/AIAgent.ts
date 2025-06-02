import { ChatMessage, LLMResponse } from '../types';

export abstract class AIAgent {
  public name: 'ALVA' | 'Bob';
  protected systemPrompt: string;
  public history: ChatMessage[]; // 共有される会話履歴の参照を持つ想定

  constructor(name: 'ALVA' | 'Bob', systemPrompt: string, sharedHistory: ChatMessage[]) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.history = sharedHistory; // conversationManagerから渡される共有履歴
  }

  protected getContextForLLM(): any[] {
    // LLM APIに合わせた形式で履歴を整形する
    // Geminiの場合: { role: 'user' | 'model', parts: [{ text: '...' }] }
    const messages: any[] = [];

    // システムプロンプトは履歴の最初のメッセージとして扱う
    messages.push({ role: 'user', parts: [{ text: this.systemPrompt }] });

    // 直近3回の会話履歴を取得
    const recentHistory = this.history.slice(-3);

    recentHistory.forEach(msg => {
      if (msg.speaker === this.name) {
        messages.push({ role: 'model', parts: [{ text: msg.text }] });
      } else if (msg.speaker === 'ALVA' || msg.speaker === 'Bob') { // 相手の発言
        messages.push({ role: 'user', parts: [{ text: msg.text }] });
      }
      // Systemメッセージはコンテキストに含めない（もしあれば）
    });
    return messages;
  }

  abstract getResponse(opponentLastMessage: string): Promise<LLMResponse>;
}
