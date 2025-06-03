import WebSocket from 'ws';
import { AgentA } from './ai/AgentA';
import { AgentB } from './ai/AgentB';
import { ChatMessage } from './types';

// ClientConversationState の定義
interface ClientConversationState {
  conversationHistory: ChatMessage[];
  agentA?: AgentA;
  agentB?: AgentB;
  isConversing: boolean;
  currentTurn: number;
  turnTimeoutId: NodeJS.Timeout | null;
}

const clientConversations = new Map<WebSocket, ClientConversationState>();

const MAX_TURNS = 10; // 会話の最大ターン数
const AUDIO_PLAYBACK_TIMEOUT = 30000; // 30秒

// 各クライアントの音声再生完了を待つためのNotifier
const audioPlaybackCompleteNotifiers = new Map<WebSocket, () => void>();

// 特定のクライアントにメッセージを送信し、そのクライアントの履歴に追加する
function sendMessageToClient(ws: WebSocket, state: ClientConversationState, message: ChatMessage) {
  state.conversationHistory.push(message);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// 特定のクライアントからの音声再生完了を待つ
async function waitForAudioPlaybackComplete(ws: WebSocket, clientState: ClientConversationState): Promise<void> {
  const lastMessage = clientState.conversationHistory.length > 0 ? clientState.conversationHistory[clientState.conversationHistory.length - 1] : null;
  if (lastMessage && lastMessage.speaker === 'System') {
    console.log(`System message for client ${ws.toString()}, not waiting for audio playback.`);
    return Promise.resolve();
  }

  const clientId = ws.toString();
  console.log(`Setting up waitForAudioPlaybackComplete for client: ${clientId}`);

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.warn(`Audio playback complete timed out for client: ${clientId} after ${AUDIO_PLAYBACK_TIMEOUT}ms`);
      audioPlaybackCompleteNotifiers.delete(ws);
      resolve();
    }, AUDIO_PLAYBACK_TIMEOUT);

    audioPlaybackCompleteNotifiers.set(ws, () => {
      clearTimeout(timeoutId);
      console.log(`Audio playback complete received from client: ${clientId}`);
      resolve();
    });
  });
}

// server.tsから呼び出される関数
export function notifyAudioPlaybackComplete(ws: WebSocket) {
  const clientId = ws.toString();
  if (audioPlaybackCompleteNotifiers.has(ws)) {
    console.log(`notifyAudioPlaybackComplete called for client: ${clientId}`);
    const resolveCallback = audioPlaybackCompleteNotifiers.get(ws);
    if (resolveCallback) {
      resolveCallback();
    }
    audioPlaybackCompleteNotifiers.delete(ws);
  } else {
    console.warn(`notifyAudioPlaybackComplete called for client: ${clientId}, but no notifier found. (Already resolved or timed out?)`);
  }
}

async function nextTurn(wss: WebSocket.Server, ws: WebSocket, clientState: ClientConversationState, currentAgent: AgentA | AgentB, opponentAgent: AgentA | AgentB) {
  if (!clientState.isConversing || clientState.currentTurn >= MAX_TURNS * 2) {
    sendMessageToClient(ws, clientState, { speaker: 'System', text: '会話が終了しました。', timestamp: new Date() });
    clientState.isConversing = false;
    return;
  }
  clientState.currentTurn++;

  const lastMessageText = clientState.conversationHistory.length > 0 ? clientState.conversationHistory[clientState.conversationHistory.length - 1].text : "会話を始めましょう。";
  
  const response = await currentAgent.getResponse(lastMessageText);

  if (response.success && response.text) {
    const newMessage: ChatMessage = {
      speaker: currentAgent.name,
      text: response.text,
      timestamp: new Date(),
    };
    sendMessageToClient(ws, clientState, newMessage);

    if (newMessage.speaker === 'ALVA' || newMessage.speaker === 'Bob') {
      console.log(`Waiting for audio playback of ${newMessage.speaker}'s message from client: ${ws.toString()}`);
      try {
        await waitForAudioPlaybackComplete(ws, clientState);
        console.log(`Client ${ws.toString()} completed audio playback for ${newMessage.speaker}'s message (or timed out/error).`);
      } catch (error) {
        console.error(`Error in waitForAudioPlaybackComplete for ${newMessage.speaker}'s message playback from client ${ws.toString()}:`, error);
      }
    }

    if (clientState.isConversing) {
      console.log(`Proceeding to nextTurn for ${opponentAgent.name} for client ${ws.toString()}.`);
      if (clientState.turnTimeoutId) clearTimeout(clientState.turnTimeoutId);
      // わずかな遅延を入れることで、連続呼び出しによる問題を緩和する場合があります。
      // 元のコードでは即時呼び出しでしたが、ここでは100msの遅延を残します。
      clientState.turnTimeoutId = setTimeout(() => {
         if (clientState.isConversing && clientState.agentA && clientState.agentB) { // 状態チェックを追加
            nextTurn(wss, ws, clientState, opponentAgent, currentAgent);
         }
      }, 100);
    }
  } else {
    const errorMessage: ChatMessage = {
      speaker: 'System',
      text: `${currentAgent.name}の応答取得に失敗しました: ${response.error || '不明なエラー'}`,
      timestamp: new Date(),
    };
    sendMessageToClient(ws, clientState, errorMessage);
    clientState.isConversing = false;
  }
}

// server.ts から呼び出される。ws は会話を開始するクライアント。
export function startConversation(wss: WebSocket.Server, ws: WebSocket) {
  let clientState = clientConversations.get(ws);

  if (clientState && clientState.isConversing) {
    sendMessageToClient(ws, clientState, { speaker: 'System', text: '既にこのクライアントで会話が進行中です。', timestamp: new Date() });
    return;
  }
  
  console.log(`Starting new conversation for client: ${ws.toString()}...`);
  
  const newConversationHistory: ChatMessage[] = [];
  const agentA = new AgentA(newConversationHistory);
  const agentB = new AgentB(newConversationHistory);

  clientState = {
    conversationHistory: newConversationHistory,
    agentA: agentA,
    agentB: agentB,
    isConversing: true,
    currentTurn: 0,
    turnTimeoutId: null,
  };
  clientConversations.set(ws, clientState);

  const initialMessage: ChatMessage = {
    speaker: 'System',
    text: 'ALVAとBobの会話を開始します...',
    timestamp: new Date(),
  };
  sendMessageToClient(ws, clientState, initialMessage);
  
  const bobInitialQuotes = [
    "言葉とは、誤解の源泉である。（アントワーヌ・ド・サン＝テグジュペリ）",
    "まだ慌てるような時間じゃない。(仙道彰)",
    "すべての言葉は、それ自体が一個の詩である。（ラルフ・ウォルド・エマーソン）",
    "知的好奇心を満たすことほど、面白いことはない。（金田一少年の事件簿）",
    "およそ言葉は、思想を伝達する機関として甚だ不完全なものである。（夏目漱石)",
    "テクストとは、無数の文化の中心から引き出された引用の織物である。（ロラン・バルト）",
    "言葉の最も恐るべきところは、それが美しくなりうることだ。（ポール・ヴァレリー）",
    "人生とは、今日一日のことである。（ドラえもん）"
  ];
  const randomIndex = Math.floor(Math.random() * bobInitialQuotes.length);
  const firstPromptForBob = bobInitialQuotes[randomIndex];
  
  const firstBobMessage: ChatMessage = {
    speaker: 'Bob',
    text: firstPromptForBob,
    timestamp: new Date()
  };
  sendMessageToClient(ws, clientState, firstBobMessage);
  console.log(`Sent first Bob message to client ${ws.toString()}. Setting up wait for playback.`);

  (async () => {
    // clientState がこのスコープで undefined になる可能性を避けるため、Mapから再取得するか、
    // non-null assertion operator `!` を慎重に使う。ここでは上でセットしているので存在すると仮定。
    const currentClientState = clientConversations.get(ws);
    if (!currentClientState || !currentClientState.isConversing) return; // 会話が開始されていなければ何もしない

    console.log(`Waiting for audio playback from client ${ws.toString()} for initial Bob message.`);
    try {
        await waitForAudioPlaybackComplete(ws, currentClientState);
        console.log(`Client ${ws.toString()} completed audio playback for initial Bob message (or timed out/error).`);
    } catch (error) {
        console.error(`Error in waitForAudioPlaybackComplete for initial Bob message playback from client ${ws.toString()}:`, error);
    }
    
    // 再度状態を確認
    if (currentClientState.isConversing && currentClientState.agentA && currentClientState.agentB) {
        console.log(`Proceeding to nextTurn for AgentA for client ${ws.toString()}.`);
        if (currentClientState.turnTimeoutId) clearTimeout(currentClientState.turnTimeoutId);
        currentClientState.turnTimeoutId = setTimeout(() => {
            if (currentClientState.isConversing && currentClientState.agentA && currentClientState.agentB) { // 状態チェックを追加
                nextTurn(wss, ws, currentClientState, currentClientState.agentA, currentClientState.agentB);
            }
        }, 100);
    }
  })();
}

export function getConversationHistory(ws: WebSocket): ChatMessage[] {
  const state = clientConversations.get(ws);
  return state ? state.conversationHistory : [];
}

export function stopConversation(wss: WebSocket.Server, ws: WebSocket) {
  const clientState = clientConversations.get(ws);
  if (clientState && clientState.isConversing) {
    clientState.isConversing = false;
    if (clientState.turnTimeoutId) {
      clearTimeout(clientState.turnTimeoutId);
      clientState.turnTimeoutId = null;
    }
    
    if (audioPlaybackCompleteNotifiers.has(ws)) {
        const resolve = audioPlaybackCompleteNotifiers.get(ws);
        if (resolve) resolve();
        audioPlaybackCompleteNotifiers.delete(ws);
    }

    sendMessageToClient(ws, clientState, { speaker: 'System', text: '会話が手動で停止されました。', timestamp: new Date() });
    console.log(`Conversation stopped manually for client ${ws.toString()}.`);
  } else if (clientState) {
    // isConversing が false だが clientState は存在する場合
    sendMessageToClient(ws, clientState, { speaker: 'System', text: '現在、このクライアントで会話は行われていません。', timestamp: new Date() });
  } else {
    console.log(`Stop command received for client ${ws.toString()}, but no active conversation state found.`);
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ speaker: 'System', text: '会話セッションが見つかりません。', timestamp: new Date() }));
    }
  }
}

// クライアント切断時の処理 (server.tsの ws.on('close', ...) で呼び出す)
export function handleClientDisconnect(ws: WebSocket) {
    console.log(`Client disconnected: ${ws.toString()}`);
    const clientState = clientConversations.get(ws);
    if (clientState) {
        if (clientState.isConversing) {
            console.log(`Stopping conversation for disconnected client: ${ws.toString()}`);
            clientState.isConversing = false;
            if (clientState.turnTimeoutId) {
                clearTimeout(clientState.turnTimeoutId);
                clientState.turnTimeoutId = null;
            }
        }
        if (audioPlaybackCompleteNotifiers.has(ws)) {
            const resolve = audioPlaybackCompleteNotifiers.get(ws);
            if (resolve) resolve();
            audioPlaybackCompleteNotifiers.delete(ws);
        }
        clientConversations.delete(ws);
        console.log(`Cleaned up state for disconnected client: ${ws.toString()}`);
    }
}
