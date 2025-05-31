import WebSocket from 'ws';
import { AgentA } from './ai/AgentA';
import { AgentB } from './ai/AgentB';
import { ChatMessage } from './types';

let conversationHistory: ChatMessage[] = [];
let agentA: AgentA;
let agentB: AgentB;
let isConversing = false;
const MAX_TURNS = 10; // 会話の最大ターン数
let currentTurn = 0;
let turnTimeoutId: NodeJS.Timeout | null = null;

function broadcastMessage(wss: WebSocket.Server, message: ChatMessage) {
  conversationHistory.push(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

async function nextTurn(wss: WebSocket.Server, currentAgent: AgentA | AgentB, opponentAgent: AgentA | AgentB) {
  if (!isConversing || currentTurn >= MAX_TURNS * 2) { // 各エージェント1ターンで2なので*2
    broadcastMessage(wss, { speaker: 'System', text: '会話が終了しました。', timestamp: new Date() });
    isConversing = false;
    return;
  }
  currentTurn++;

  const lastMessage = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].text : "会話を始めましょう。";
  
  // broadcastMessage(wss, { speaker: 'System', text: `${currentAgent.name}が思考中です...`, timestamp: new Date()}); // 「思考中です」メッセージを削除

  const response = await currentAgent.getResponse(lastMessage);

  if (response.success && response.text) {
    const newMessage: ChatMessage = {
      speaker: currentAgent.name,
      text: response.text,
      timestamp: new Date(),
    };
    broadcastMessage(wss, newMessage);
    // 遅延を挟んで相手のターンへ
    if (isConversing) { // Check if conversation is still active before scheduling next turn
      turnTimeoutId = setTimeout(() => nextTurn(wss, opponentAgent, currentAgent), 1000);
    }
  } else {
    const errorMessage: ChatMessage = {
      speaker: 'System',
      text: `${currentAgent.name}の応答取得に失敗しました: ${response.error || '不明なエラー'}`,
      timestamp: new Date(),
    };
    broadcastMessage(wss, errorMessage);
    isConversing = false; // エラー時は会話を停止
  }
}

export function startConversation(wss: WebSocket.Server) {
  if (isConversing) {
    broadcastMessage(wss, { speaker: 'System', text: '既に会話が進行中です。', timestamp: new Date() });
    return;
  }
  
  console.log("Starting new conversation...");
  conversationHistory = []; // 履歴をリセット
  agentA = new AgentA(conversationHistory);
  agentB = new AgentB(conversationHistory);
  currentTurn = 0;
  isConversing = true;

  const initialMessage: ChatMessage = {
    speaker: 'System',
    text: 'ALVAとBobの会話を開始します...',
    timestamp: new Date(),
  };
  broadcastMessage(wss, initialMessage);
  
  // Bobから会話を開始
  const firstPromptForBob = "それで僕は、ポケットからあの赤いハンチングを出してかぶったんだ (ライ麦畑でつかまえて）";
  const firstBobMessage: ChatMessage = {
    speaker: 'Bob',
    text: firstPromptForBob,
    timestamp: new Date()
  };
  broadcastMessage(wss, firstBobMessage);

  setTimeout(() => nextTurn(wss, agentA, agentB), 500); // ALVAのターンから開始
}

export function getConversationHistory(): ChatMessage[] {
  return conversationHistory;
}

export function stopConversation(wss: WebSocket.Server) {
  if (isConversing) {
    isConversing = false;
    if (turnTimeoutId) {
      clearTimeout(turnTimeoutId);
      turnTimeoutId = null;
    }
    broadcastMessage(wss, { speaker: 'System', text: '会話が手動で停止されました。', timestamp: new Date() });
    console.log("Conversation stopped manually.");
  } else {
    broadcastMessage(wss, { speaker: 'System', text: '現在、会話は行われていません。', timestamp: new Date() });
  }
}
