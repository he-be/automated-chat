import './style.css';

interface ChatMessage {
  speaker: 'ALVA' | 'Bob' | 'System';
  text: string;
  timestamp: string; // ISO文字列で受け取る想定
}

const startButton = document.getElementById('startButton') as HTMLButtonElement;
const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
const chatArea = document.getElementById('chatArea') as HTMLDivElement; // AIメッセージ用アニメーションの親として利用するかも
const systemMessageContainer = document.getElementById('systemMessageContainer') as HTMLDivElement;

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
      } else if (message.speaker === 'ALVA' || message.speaker === 'Bob') {
        // If an AI message comes, ensure stop button is enabled and start is disabled
        startButton.disabled = true;
        stopButton.disabled = false;
        startButton.style.display = 'none';
        stopButton.style.display = 'block';
        // Play audio and wait for it to finish before sending confirmation
        (async () => {
          // message.speakerが 'ALVA' | 'Bob' であることをここで保証
          await playMessageAudio(message.text, message.speaker as 'ALVA' | 'Bob'); 
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'AUDIO_PLAYBACK_COMPLETE', speaker: message.speaker }));
          }
        })();
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


const ANIMATION_DURATION = 5000; // ms, CSSのanimation-durationと合わせるか、ここから設定する

function appendMessage(message: ChatMessage) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', `speaker-${message.speaker}`);
  
  let messageText = message.text;
  let authorLine = '';

  // 著者のカッコを見つけて分割
  const authorMatch = messageText.match(/\(([^)]+)\)$/);
  if (authorMatch) {
    authorLine = authorMatch[0]; // 例: (夏目漱石)
    messageText = messageText.substring(0, messageText.lastIndexOf(authorMatch[0])).trim();
    // カッコの直前で改行を強制（ただし、元々改行がある場合はそのまま）
    // messageText = messageText.replace(/\s*\(([^)]+)\)$/, '\n$&');
  }

  const quoteElement = document.createElement('p');
  quoteElement.classList.add('quote-text');
  quoteElement.innerText = messageText; // innerTextで改行を保持
  messageElement.appendChild(quoteElement);

  if (authorLine) {
    const authorElement = document.createElement('p');
    authorElement.classList.add('author-line');
    authorElement.textContent = authorLine;
    messageElement.appendChild(authorElement);
  }


  if (message.speaker === 'System') {
    // システムメッセージは #systemMessageContainer に追加
    if (systemMessageContainer) {
      // 古いシステムメッセージを削除
      while (systemMessageContainer.firstChild) {
        systemMessageContainer.removeChild(systemMessageContainer.firstChild);
      }
      systemMessageContainer.appendChild(messageElement);
    } else {
      console.error("systemMessageContainer not found!"); // Fallback or error handling
      chatArea.appendChild(messageElement); // Fallback to old behavior
    }
  } else {
    // ALVAとBobのメッセージはアニメーション付きで表示
    // messageElement.style.position = 'absolute'; // CSSで設定済み

    // 左右の配置はCSSで行うため、ここではtextAlignのみ設定
    if (message.speaker === 'ALVA') {
      messageElement.classList.add('align-right');
    } else { // Bob
      messageElement.classList.add('align-left');
    }
    
    // アニメーションクラスを追加（CSSで定義されたものを参照）
    messageElement.classList.add('animate-message');
    // messageElement.style.animation = `fadeInMoveUpAndFadeOut ${ANIMATION_DURATION / 1000}s ease-in-out forwards`;
    
    // chatAreaではなく、#app直下に追加して画面全体でアニメーションさせる
    const appElement = document.getElementById('app');
    if (appElement) {
        appElement.appendChild(messageElement);
    }


    // アニメーション終了後に要素を削除
    setTimeout(() => {
      messageElement.remove();
    }, ANIMATION_DURATION);
  }
}

// --- TTS再生機能 ---
const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
let currentAudioSource: AudioBufferSourceNode | null = null;

function playMessageAudio(text: string, speaker: 'ALVA' | 'Bob'): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (currentAudioSource) {
      currentAudioSource.onended = null; // 前のonendedハンドラをクリア
      currentAudioSource.stop(); // 現在再生中の音声を停止
      currentAudioSource.disconnect();
      currentAudioSource = null;
    }

  // TTSサーバーへのリクエストパラメータ
  // curl -X 'GET' \
  // 'https://tts.do-not-connect.com/voice?text=aaa&model_id=0&speaker_id=0&sdp_ratio=0.2&noise=0.6&noisew=0.8&length=1&language=JP&auto_split=true&split_interval=0.5&assist_text_weight=1&style=Neutral&style_weight=1'
  const ttsParams = {
    message: text,
    stylebertvits2ModelId: speaker === 'ALVA' ? '5' : '1', // ALVA: model_id 0, Bob: model_id 1 (仮)
    stylebertvits2SpeakerId: '0', // speaker_id は常に 0 とする
    stylebertvits2SdpRatio: 0.2,
    stylebertvits2Noise: 0.6, // Default from curl
    stylebertvits2NoiseW: 0.8, // Default from curl
    stylebertvits2Length: 1.0,
    selectLanguage: 'ja', // 日本語固定
    stylebertvits2AutoSplit: "true", // Default from curl
    stylebertvits2SplitInterval: 0.5, // Default from curl
    stylebertvits2AssistTextWeight: 1, // Default from curl
    stylebertvits2Style: 'Neutral', // ALVA: Neutral, Bob: Happy (仮)
    stylebertvits2StyleWeight: 1, // Default from curl
    // stylebertvits2ServerUrl, stylebertvits2ApiKey, cfAccessClientId, cfAccessClientSecret はバックエンドで処理
  };

  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsParams),
    });

    if (!response.ok) {
      let errorDetail = `HTTPステータス: ${response.status}`;
      let responseText = '';
      try {
        responseText = await response.text(); // まずテキストとして取得
        errorDetail += ` - ${responseText}`; // テキスト内容を詳細に追加
        // テキストがJSON形式であれば、その中のエラーメッセージを抽出試行
        try {
            const jsonData = JSON.parse(responseText);
            if (jsonData && jsonData.error) {
                errorDetail = `TTS APIエラー: ${jsonData.error} (HTTP ${response.status})`;
            } else {
                errorDetail = `TTS APIエラー: ${responseText} (HTTP ${response.status})`;
            }
        } catch (jsonError) {
            // JSONパース失敗時は、取得したテキストをそのままエラーメッセージとして扱う
             errorDetail = `TTS APIからの予期せぬ応答 (HTTP ${response.status}): ${responseText}`;
        }
      } catch (textError) {
        // レスポンスボディの読み取り自体に失敗した場合
        errorDetail += ' (レスポンスボディの読み取りにも失敗)';
      }
      console.error(`TTS APIエラー詳細: ${errorDetail}`);
      appendMessage({ speaker: 'System', text: `音声の取得に失敗しました. ${errorDetail}`, timestamp: new Date().toISOString() });
      return;
    }

    const audioData = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(audioData);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    currentAudioSource = source; // 現在の音源を保存

    source.onended = () => {
      if (currentAudioSource === source) { // 他の音声で上書きされていない場合のみクリア
        currentAudioSource = null;
      }
      resolve(); // 音声再生完了
    };

  } catch (error) {
    console.error('TTSリクエストまたは音声再生エラー:', error);
    appendMessage({ speaker: 'System', text: `音声再生エラー: ${(error as Error).message}`, timestamp: new Date().toISOString() });
    reject(error); // エラー時
  }
});
}
// --- TTS再生機能ここまで ---


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
