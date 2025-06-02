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

// 各クライアントの音声再生完了を待つためのNotifier
// キーはWebSocketクライアントの一意な識別子（ここでは単純化のため、wsオブジェクト自体を使用するが、
// 本番環境ではより堅牢なID管理が必要な場合がある）
// 値はPromiseのresolve関数
const audioPlaybackCompleteNotifiers = new Map<WebSocket, () => void>();
const AUDIO_PLAYBACK_TIMEOUT = 30000; // 30秒

function broadcastMessage(wss: WebSocket.Server, message: ChatMessage) {
  conversationHistory.push(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// 特定のクライアントからの音声再生完了を待つ
async function waitForAudioPlaybackComplete(ws: WebSocket): Promise<void> {
  // システムメッセージの場合は待たない
  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (lastMessage && lastMessage.speaker === 'System') {
    console.log("System message, not waiting for audio playback.");
    return Promise.resolve();
  }

  // クライアントの識別子（ここでは仮にwsオブジェクトのハッシュや一意のIDを使うべきだが、簡略化）
  const clientId = ws.toString(); // 仮のクライアントID (本番ではより良い方法で)

  console.log(`Setting up waitForAudioPlaybackComplete for client: ${clientId}`);

  return new Promise((resolve) => { // rejectも引数に取れるが、今回はタイムアウト時もresolve
    const timeoutId = setTimeout(() => {
      console.warn(`Audio playback complete timed out for client: ${clientId} after ${AUDIO_PLAYBACK_TIMEOUT}ms`);
      audioPlaybackCompleteNotifiers.delete(ws); // タイムアウトしたらMapから削除
      resolve(); // タイムアウト時もresolveして処理を続行させる
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
  const clientId = ws.toString(); // 仮のクライアントID
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


async function nextTurn(wss: WebSocket.Server, currentAgent: AgentA | AgentB, opponentAgent: AgentA | AgentB) {
  if (!isConversing || currentTurn >= MAX_TURNS * 2) { // 各エージェント1ターンで2なので*2
    broadcastMessage(wss, { speaker: 'System', text: '会話が終了しました。', timestamp: new Date() });
    isConversing = false;
    audioPlaybackCompleteNotifiers.clear(); // 会話終了時にクリア
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

    // AIの発言後、全クライアントの音声再生完了を待つ
    // 実際には、メッセージを送信したクライアントのみを対象にするか、
    // または全クライアントからの完了通知を待つ必要がある。
    // ここでは簡略化のため、接続している最初のクライアントを対象とするか、
    // もしくはwss.clientsをループしてPromise.allで待つ。
    // 今回は、各クライアントが個別にAUDIO_PLAYBACK_COMPLETEを送るので、
    // サーバー側では誰からの通知かを特定して対応する。
    // nextTurnは会話全体の流れを制御するので、特定のクライアントに依存せず、
    // 「誰かが再生し終わったら次へ」というよりは、
    // 「次のAIが話す前に、前のAIの音声が再生され終わっていることを期待する」
    // という形になる。
    // 厳密には、最後に発言したAIのメッセージに対して、全クライアントが再生完了するのを待つべき。
    // ここでは、いずれかのクライアントが再生完了通知を送ってきたら次に進む、という簡易的な実装。
    // 実際には、最後に発言したAIのメッセージIDなどを付与し、それに対する完了を待つのが良い。

    // ひとまず、接続しているクライアントのいずれかが再生完了通知を送るのを待つ
    // 複数のクライアントがいる場合、この実装では最初の通知で次に進んでしまう。
    // より堅牢にするには、全クライアントの完了を待つか、発言者ごとに管理する。
    // 今回は、会話は1対1の表示を想定しているため、最初のクライアントの完了を待つ。
    if (wss.clients.size > 0) {
        // どのクライアントの再生を待つか？ 実際には発言を受け取った全クライアント。
        // ここでは、wss.clientsの最初のクライアントを代表として待つことにする。
        // ただし、これはデモ用の単純化。
        // 実際には、メッセージを送信したクライアント全てからの完了を待つか、
        // 最後に発言したAIのメッセージに対する完了を待つ必要がある。
        // 今回は、最後に発言したのがAIの場合のみ待つ。
        if (newMessage.speaker === 'ALVA' || newMessage.speaker === 'Bob') {
            console.log(`Waiting for audio playback of ${newMessage.speaker}'s message from ${wss.clients.size} clients.`);
            const playbackPromises = Array.from(wss.clients).map(client => {
                const clientIdentifier = client.toString(); // 仮
                console.log(` - Setting up wait for client: ${clientIdentifier} for ${newMessage.speaker}'s message.`);
                if (client.readyState === WebSocket.OPEN) {
                    return waitForAudioPlaybackComplete(client).catch(err => {
                        console.error(`Error waiting for playback from ${clientIdentifier} for ${newMessage.speaker}'s message:`, err);
                        return Promise.resolve(); // エラー時も全体を止めない
                    });
                }
                console.log(` - Client ${clientIdentifier} not open, resolving immediately for ${newMessage.speaker}'s message.`);
                return Promise.resolve(); // 接続が切れていたら待たない
            });
            try {
              await Promise.all(playbackPromises);
              console.log(`All clients completed audio playback for ${newMessage.speaker}'s message (or timed out/error).`);
            } catch (error) {
              console.error(`Error in Promise.all for ${newMessage.speaker}'s message playback:`, error);
            }
        }
    }


    // 遅延を挟んで相手のターンへ
    if (isConversing) { // Check if conversation is still active before scheduling next turn
      console.log(`Proceeding to nextTurn for ${opponentAgent.name}.`);
      nextTurn(wss, opponentAgent, currentAgent); // すぐに次のターンへ
    }
  } else {
    const errorMessage: ChatMessage = {
      speaker: 'System',
      text: `${currentAgent.name}の応答取得に失敗しました: ${response.error || '不明なエラー'}`,
      timestamp: new Date(),
    };
    broadcastMessage(wss, errorMessage);
    isConversing = false; // エラー時は会話を停止
    audioPlaybackCompleteNotifiers.clear(); // エラー時もクリア
  }
}

export function startConversation(wss: WebSocket.Server) {
  if (isConversing) {
    broadcastMessage(wss, { speaker: 'System', text: '既に会話が進行中です。', timestamp: new Date() });
    return;
  }
  
  console.log("Starting new conversation...");
  conversationHistory = []; // 履歴をリセット
  audioPlaybackCompleteNotifiers.clear(); // 開始時にクリア
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
  const bobInitialQuotes = [
    "言葉とは、誤解の源泉である。（アントワーヌ・ド・サン＝テグジュペリ）",
    "意味は使用のうちにある。（ルートヴィヒ・ウィトゲンシュタイン）",
    "すべての言葉は、それ自体が一個の詩である。（ラルフ・ウォルド・エマーソン）",
    "言葉は思考の直接の現実である。（カール・マルクス）",
    "およそ言葉は、思想を伝達する機関として甚だ不完全なものである。（夏目漱石)",
    "テクストとは、無数の文化の中心から引き出された引用の織物である。（ロラン・バルト）",
    "人は言葉の助けをかりて嘘をつくが、身振りにおいては真実がにじみ出る。（フリードリヒ・ニーチェ）",
    "言葉の最も恐るべきところは、それが美しくなりうることだ。（ポール・ヴァレリー）"
  ];
  const randomIndex = Math.floor(Math.random() * bobInitialQuotes.length);
  const firstPromptForBob = bobInitialQuotes[randomIndex];
  
  const firstBobMessage: ChatMessage = {
    speaker: 'Bob',
    text: firstPromptForBob,
    timestamp: new Date()
  };
  broadcastMessage(wss, firstBobMessage);
  console.log("Broadcasted first Bob message. Setting up wait for playback.");

  // Bobの最初の発言の再生完了を待つ
  (async () => {
    if (wss.clients.size > 0) {
        console.log(`Waiting for audio playback from ${wss.clients.size} clients for initial Bob message.`);
        const playbackPromises = Array.from(wss.clients).map(client => {
            const clientIdentifier = client.toString(); // 仮
            console.log(` - Setting up wait for client: ${clientIdentifier}`);
            if (client.readyState === WebSocket.OPEN) {
                return waitForAudioPlaybackComplete(client).catch(err => {
                    console.error(`Error waiting for playback from ${clientIdentifier}:`, err);
                    return Promise.resolve(); // エラー時も全体を止めない
                });
            }
            console.log(` - Client ${clientIdentifier} not open, resolving immediately.`);
            return Promise.resolve();
        });
        try {
            await Promise.all(playbackPromises);
            console.log("All clients completed audio playback for initial Bob message (or timed out/error).");
        } catch (error) {
            console.error("Error in Promise.all for initial Bob message playback:", error);
        }
    } else {
        console.log("No clients connected, proceeding without waiting for playback.");
    }
    console.log("Proceeding to nextTurn for AgentA.");
    nextTurn(wss, agentA, agentB); // すぐにALVAのターンへ
  })();
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
    // 停止時には待機中のPromiseを強制的に解決する
    audioPlaybackCompleteNotifiers.forEach(resolve => resolve());
    audioPlaybackCompleteNotifiers.clear();

    broadcastMessage(wss, { speaker: 'System', text: '会話が手動で停止されました。', timestamp: new Date() });
    console.log("Conversation stopped manually.");
  } else {
    broadcastMessage(wss, { speaker: 'System', text: '現在、会話は行われていません。', timestamp: new Date() });
  }
}
