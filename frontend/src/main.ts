import './style.css';

interface ChatMessage {
  speaker: 'ALVA' | 'Bob' | 'System';
  text: string;
  timestamp: string; // ISO文字列で受け取る想定
}

const startButton = document.getElementById('startButton') as HTMLButtonElement;
const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
const chatArea = document.getElementById('chatArea') as HTMLDivElement;

// バックエンドのWebSocketサーバーのURL
// Vite開発サーバー経由ではなく直接接続する場合
const WS_URL = 'ws://localhost:3000'; 
let socket: WebSocket | null = null;

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    console.log('WebSocketは既に接続済みか、接続中です。');
    return;
  }

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('WebSocket接続が確立されました');
    appendMessage({ speaker: 'System', text: 'サーバーに接続しました。', timestamp: new Date().toISOString() });
    startButton.disabled = false;
    stopButton.disabled = true;
    startButton.style.display = 'block';
    stopButton.style.display = 'none';
  };

  socket.onmessage = (event) => {
    try {
      const message: ChatMessage = JSON.parse(event.data as string);
      appendMessage(message);
      if (message.speaker === 'System' && 
          (message.text === '会話が終了しました。' || 
           message.text.includes('応答取得に失敗しました') ||
           message.text === '会話が手動で停止されました。')) {
        startButton.disabled = false;
        stopButton.disabled = true;
        startButton.style.display = 'block';
        stopButton.style.display = 'none';
      } else if (message.speaker !== 'System') {
        // If an AI message comes, ensure stop button is enabled and start is disabled
        startButton.disabled = true;
        stopButton.disabled = false;
        startButton.style.display = 'none';
        stopButton.style.display = 'block';
      }
    } catch (error) {
      console.error('メッセージの解析に失敗しました、またはメッセージ形式が無効です:', event.data, error);
      appendMessage({ speaker: 'System', text: `エラー: 不明なメッセージを受信しました。 ${event.data}`, timestamp: new Date().toISOString() });
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocketエラー:', error);
    appendMessage({ speaker: 'System', text: 'WebSocketエラーが発生しました。コンソールを確認してください。', timestamp: new Date().toISOString() });
  };

  socket.onclose = () => {
    console.log('WebSocket接続が閉じられました');
    appendMessage({ speaker: 'System', text: 'サーバーとの接続が切れました。', timestamp: new Date().toISOString() });
    socket = null; // Allow reconnection
    startButton.disabled = true; // Disable start until reconnected
    stopButton.disabled = true;
    startButton.style.display = 'block'; // Show start, hide stop
    stopButton.style.display = 'none';
  };
}


function appendMessage(message: ChatMessage) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', `speaker-${message.speaker}`);

  const speakerLabel = document.createElement('span');
  speakerLabel.classList.add('speaker-label');
  speakerLabel.textContent = message.speaker === 'System' ? 'システム' : message.speaker;
  
  const textElement = document.createElement('p');
  textElement.classList.add('text');
  textElement.textContent = message.text;

  const timeElement = document.createElement('span');
  timeElement.classList.add('timestamp');
  timeElement.textContent = new Date(message.timestamp).toLocaleTimeString();
  
  messageElement.appendChild(speakerLabel);
  messageElement.appendChild(textElement);
  messageElement.appendChild(timeElement);
  
  chatArea.appendChild(messageElement);
  chatArea.scrollTop = chatArea.scrollHeight; // 自動スクロール
}

startButton.addEventListener('click', async () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendMessage({ speaker: 'System', text: 'WebSocketが接続されていません。「会話開始」の前に接続を試みます。', timestamp: new Date().toISOString() });
    connectWebSocket(); // 試行
    // 少し待ってからリトライするか、ユーザーに再度ボタンを押してもらう
    await new Promise(resolve => setTimeout(resolve, 1000)); 
    if (!socket || socket.readyState !== WebSocket.OPEN) {
       appendMessage({ speaker: 'System', text: '接続に失敗しました。ページをリロードするか、バックエンドサーバーが起動しているか確認してください。', timestamp: new Date().toISOString() });
       return;
    }
  }
  
  // HTTP POSTで会話開始をトリガー
  try {
    const response = await fetch('/start-conversation', { method: 'POST' });
    if (response.ok) {
      appendMessage({ speaker: 'System', text: '会話開始リクエストを送信しました。', timestamp: new Date().toISOString() });
      startButton.disabled = true;
      stopButton.disabled = false;
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
    } else {
      appendMessage({ speaker: 'System', text: `会話開始リクエスト失敗: ${response.statusText}`, timestamp: new Date().toISOString() });
    }
  } catch (error) {
    console.error('会話開始リクエストの送信に失敗しました:', error);
    appendMessage({ speaker: 'System', text: `会話開始リクエストエラー: ${(error as Error).message}`, timestamp: new Date().toISOString() });
  }
});

stopButton.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send('STOP_CONVERSATION');
    appendMessage({ speaker: 'System', text: '会話停止リクエストを送信しました。', timestamp: new Date().toISOString() });
    // Backend will send a "Conversation ended" message, which will trigger button state update
  } else {
    appendMessage({ speaker: 'System', text: 'WebSocketが接続されていません。', timestamp: new Date().toISOString() });
  }
});

// 初期接続試行
startButton.disabled = true; // Disable until connected
stopButton.disabled = true;
connectWebSocket();
