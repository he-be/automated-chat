import { LLMResponse, ModelType } from '../types';
import axios from 'axios';
// import OpenAI from 'openai'; // 例
import { GoogleGenerativeAI } from "@google/generative-ai"; // 例

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const OLLAMA_ENDPOINT = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "gemma3:12b-it-qat";

export async function callLLM(
  modelType: ModelType,
  messages: any[], // APIに合わせたメッセージ形式
  agentName: 'ALVA' | 'Bob' // デバッグやダミー応答用
): Promise<LLMResponse> {
  console.log(`[LLM Client] Calling ${modelType} for Agent ${agentName} with messages:`, JSON.stringify(messages.slice(-3), null, 2)); // ログは適度に

  if (modelType === 'ollama') {
    try {
      // Ollama APIに送信するメッセージ形式に変換
      // AIAgent.getContextForLLM() は { role: 'user'/'model', parts: [{ text: '...' }] } を返す
      // Ollama は { role: 'user'/'assistant', content: '...' } を期待する
      const ollamaMessages = messages.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role, // 'model' を 'assistant' に変換
        content: msg.parts[0].text // parts配列の最初の要素のtextを使用
      }));

      const response = await axios.post(OLLAMA_ENDPOINT, {
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: false, // ストリーミングは無効
      });
      return { success: true, text: response.data.message.content };
    } catch (error) {
      console.error("Ollama API Error:", error);
      return { success: false, error: (error as Error).message };
    }
  } else if (modelType === 'gemini') {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest"});
      // Gemini APIのsendMessageは、最後のメッセージの内容を直接受け取る
      const chat = model.startChat({ history: messages.slice(0, -1) });
      const result = await chat.sendMessage(messages[messages.length - 1].parts);
      const response = result.response;
      return { success: true, text: response.text() };
    } catch (error) {
      console.error("Gemini API Error:", error);
      return { success: false, error: (error as Error).message };
    }
  } else if (modelType === 'dummy') {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 擬似的な遅延
    let dummyText = "";
    if (agentName === 'ALVA') {
        dummyText = `ふむふむ、なるほどね。それでそれで？ (ダミー応答 ALVA)`;
    } else { // Agent Bob
        const quotes = [
            "「事実は小説よりも奇なり。」(ダミー引用)",
            "「明日は明日の風が吹く。」(ダミー引用)",
            "「求めよ、さらば与えられん。」(ダミー引用)"
        ];
        dummyText = quotes[Math.floor(Math.random() * quotes.length)];
    }
    return { success: true, text: dummyText };
  }

  return { success: false, error: `Unsupported model type: ${modelType}` };
}
