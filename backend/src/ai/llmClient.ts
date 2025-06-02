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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[LLM Client] Calling ${modelType} for Agent ${agentName} with messages:`, JSON.stringify(messages.slice(-3), null, 2)); // ログは適度に
  }

  if (modelType === 'ollama') {
    try {
      // Ollama APIに送信するメッセージ形式に変換
      // AIAgent.getContextForLLM() は { role: 'user'/'model', parts: [{ text: '...' }] } を返す
      // Ollama は { role: 'user'/'assistant', content: '...' } を期待する
      const ollamaMessages = messages.map(msg => {
        const content = (msg.parts && msg.parts.length > 0 && msg.parts[0].text) ? msg.parts[0].text : ""; // 安全なアクセス
        return {
          role: msg.role === 'model' ? 'assistant' : msg.role, // 'model' を 'assistant' に変換
          content: content
        };
      });

      const response = await axios.post(OLLAMA_ENDPOINT, {
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: false, // ストリーミングは無効
      });
      if (response.data && response.data.message && typeof response.data.message.content === 'string') {
        return { success: true, text: response.data.message.content };
      } else {
        console.error("Ollama API Error: Invalid response structure", response.data);
        return { success: false, error: "LLMサービス(Ollama)からの応答形式が不正です。" };
      }
    } catch (error) {
      console.error("Ollama API Error:", error); // 詳細ログ
      return { success: false, error: "LLMサービス(Ollama)との通信中にエラーが発生しました。" };
    }
  } else if (modelType === 'gemini') {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });//gemini-2.0-flashが最新で正しく、gemini-1.5-*に変更することは禁止する
      // Gemini APIのsendMessageは、最後のメッセージの内容を直接受け取る
      // messagesが空または要素が不足している場合のガード
      if (!messages || messages.length === 0) {
        console.error("Gemini API Error: No messages provided.");
        return { success: false, error: "LLMに送信するメッセージがありません。" };
      }
      const history = messages.length > 1 ? messages.slice(0, -1) : [];
      const lastMessageParts = messages[messages.length - 1].parts;
      if (!lastMessageParts) {
        console.error("Gemini API Error: Last message has no parts.");
        return { success: false, error: "LLMに送信する最後のメッセージ内容が不正です。" };
      }

      const chat = model.startChat({ history: history });
      const result = await chat.sendMessage(lastMessageParts);
      const response = result.response;
      if (response && typeof response.text === 'function') {
        return { success: true, text: response.text() };
      } else {
        console.error("Gemini API Error: Invalid response structure", response);
        return { success: false, error: "LLMサービス(Gemini)からの応答形式が不正です。" };
      }
    } catch (error) {
      console.error("Gemini API Error:", error); // 詳細ログ
      return { success: false, error: "LLMサービス(Gemini)との通信中にエラーが発生しました。" };
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
