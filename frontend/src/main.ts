import './style.css';

interface ChatMessage {
  speaker: 'ALVA' | 'Bob' | 'System';
  text: string;
  timestamp: string; // ISO文字列で受け取る想定
}

const startButton = document.getElementById('startButton') as HTMLButtonElement;
const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
const chatArea = document.getElementById('chatArea') as HTMLDivElement;
const systemMessageContainer = document.getElementById('systemMessageContainer') as HTMLDivElement;
const backgroundLogElement = document.getElementById('backgroundConversationLog') as HTMLDivElement;
const currentQuoteSourceElement = document.getElementById('currentQuoteSource') as HTMLParagraphElement;

let fullConversationText = ""; // To store the entire conversation for the background
// const MAX_BG_LOG_LENGTH = 5000; // Characters, adjust as needed - This logic will be removed for scrolling

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
      // Consider adding more robust parsing and type validation here if needed
      const message = JSON.parse(event.data as string) as ChatMessage;
      appendMessage(message);

      if (message.speaker === 'System' &&
          (message.text === '会話が終了しました。' ||
           message.text.includes('応答取得に失敗しました') ||
           message.text === '会話が手動で停止されました。')) {
        startButton.disabled = false;
        stopButton.disabled = true;
        startButton.style.display = 'block';
        stopButton.style.display = 'none';
      } else if (isAlvaOrBob(message.speaker)) { // Use type guard
        startButton.disabled = true;
        stopButton.disabled = false;
        startButton.style.display = 'none';
        stopButton.style.display = 'block';
        // Capture the narrowed type in a local variable before the async closure
        const speakerForAudio: 'ALVA' | 'Bob' = message.speaker;
        (async () => {
          await playMessageAudio(message.text, speakerForAudio);
          if (socket && socket.readyState === WebSocket.OPEN) {
            // Using speakerForAudio here as well for consistency, though message.speaker would also be fine
            // if the outer scope's narrowing is trusted by all TS versions/configurations.
            socket.send(JSON.stringify({ type: 'AUDIO_PLAYBACK_COMPLETE', speaker: speakerForAudio }));
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
    socket = null;
    startButton.disabled = true;
    stopButton.disabled = true;
    startButton.style.display = 'block';
    stopButton.style.display = 'none';
  };
}

const TYPEWRITER_DELAY = 30; // ms per character
const FADEOUT_DURATION = 500; // ms, should match CSS animation

// Type guard to check if speaker is ALVA or Bob
function isAlvaOrBob(speaker: ChatMessage['speaker']): speaker is 'ALVA' | 'Bob' {
  return speaker === 'ALVA' || speaker === 'Bob';
}

async function typewriterEffect(element: HTMLElement, text: string, cursor: HTMLElement, onComplete?: () => void) {
  element.textContent = ''; // Clear existing text
  for (let i = 0; i < text.length; i++) {
    element.textContent += text[i];
    await new Promise(resolve => setTimeout(resolve, TYPEWRITER_DELAY));
  }
  cursor.remove(); // Remove cursor when typing is done
  if (onComplete) {
    onComplete();
  }
}

function appendMessage(message: ChatMessage) {
  // Update background conversation log for ALVA and Bob messages
  if (backgroundLogElement && (message.speaker === 'ALVA' || message.speaker === 'Bob')) {
    // Logic for clearing log when it's too long is removed in favor of scrolling.
    // if (fullConversationText.length > MAX_BG_LOG_LENGTH) {
    //   fullConversationText = ""; 
    // }
    let logEntry = "";
    // Extract actual text content without author for the log
    const textOnlyMatch = message.text.match(/^(.*?)(?:\s*[(（][^)）]+[)）]\s*)?$/);
    const textForLog = textOnlyMatch ? textOnlyMatch[1].trim() : message.text.trim(); // Trim text for log

    if (message.speaker === 'ALVA') {
      logEntry = `<span class="bg-log-alva">${textForLog}</span> `; // Add space instead of newline
    } else { // Bob
      logEntry = `${textForLog} `; // Add space instead of newline
    }
    fullConversationText += logEntry;
    backgroundLogElement.innerHTML = fullConversationText;
    // Scroll to the bottom of the background log
    backgroundLogElement.scrollTop = backgroundLogElement.scrollHeight;
  }

  if (message.speaker === 'System') {
    if (systemMessageContainer) {
      // Clear previous system messages
      while (systemMessageContainer.firstChild) {
        systemMessageContainer.removeChild(systemMessageContainer.firstChild);
      }
      const systemMessageElement = document.createElement('div');
      systemMessageElement.classList.add('message', 'speaker-System');
      systemMessageElement.textContent = message.text;
      systemMessageContainer.appendChild(systemMessageElement);
    } else {
      console.error("systemMessageContainer not found!");
    }
    return; // System messages don't use the main chatArea animations
  }

  // Fade out existing messages in chatArea and clear current quote source
  const existingMessages = chatArea.querySelectorAll('.message:not(.speaker-System)');
  existingMessages.forEach(msg => {
    msg.classList.add('message-fade-out');
    setTimeout(() => msg.remove(), FADEOUT_DURATION);
  });
  // Clear and hide previous quote source
  if (currentQuoteSourceElement) {
    currentQuoteSourceElement.textContent = "";
    currentQuoteSourceElement.classList.remove('quote-source-animate');
    currentQuoteSourceElement.style.opacity = '0'; // Ensure it's hidden before new one animates
  }

  const messageElement = document.createElement('div');
  messageElement.classList.add('message', `speaker-${message.speaker}`);
  // ALVA/Bob specific classes for potential different styling (e.g. text-align, color)
  // These classes would need to be defined in style.css if used.
  // Example:
  // if (message.speaker === 'ALVA') messageElement.classList.add('message-alva');
  // if (message.speaker === 'Bob') messageElement.classList.add('message-bob');

  let messageTextContent = message.text;
  let displayAuthorName: string; // Explicitly string for the author name to be displayed

  // message.speaker is 'ALVA' | 'Bob' at this point due to the early return for 'System'.
  // The cast `as 'ALVA' | 'Bob'` is removed as TypeScript should infer this correctly.
  const currentSpeaker = message.speaker;


  // Extract author from parentheses if present, e.g., "Quote text (Author Name)"
  // Supports both half-width and full-width parentheses, and optional trailing spaces.
  const authorMatch = messageTextContent.match(/[(（]([^)）]+)[)）]\s*$/);
  if (authorMatch && authorMatch[1]) {
    displayAuthorName = authorMatch[1].trim(); // Use name from parentheses, trim whitespace
    messageTextContent = messageTextContent.substring(0, messageTextContent.lastIndexOf(authorMatch[0])).trim();
  } else {
    displayAuthorName = currentSpeaker; // Default to speaker name ('ALVA' or 'Bob')
  }

  const quoteTextContainer = document.createElement('div'); // Container for text and cursor
  quoteTextContainer.classList.add('quote-text-container'); // For potential styling

  const quoteTextElement = document.createElement('span'); // Use span for inline behavior with cursor
  quoteTextElement.classList.add('quote-text');
  // quoteTextElement.textContent = messageTextContent; // Text will be set by typewriter

  const cursorElement = document.createElement('span');
  cursorElement.classList.add('typewriter-cursor');

  quoteTextContainer.appendChild(quoteTextElement);
  quoteTextContainer.appendChild(cursorElement);
  messageElement.appendChild(quoteTextContainer);

  // Note: The authorElement <p class="quote-source"> is no longer created per message.
  // We will update the #currentQuoteSource element instead.

  chatArea.appendChild(messageElement);
  messageElement.classList.add('message-fade-in'); // Trigger fade-in

  // Start typewriter after a short delay to allow fade-in to start
  setTimeout(() => {
    typewriterEffect(quoteTextElement, messageTextContent, cursorElement, () => {
      // After typewriter is complete, update and animate the dedicated quote source element
      if (currentQuoteSourceElement) {
        currentQuoteSourceElement.textContent = `— ${displayAuthorName}`;
        currentQuoteSourceElement.style.opacity = '0'; // Reset for animation
        // Force reflow before adding animation class to ensure transition plays
        void currentQuoteSourceElement.offsetWidth; 
        currentQuoteSourceElement.classList.add('quote-source-animate');
      }
    });
  }, 100); // Small delay for fade-in to kick in
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
