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

// WebSocketサーバーのURL (Vite環境変数から取得)
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8787/websocket'; // デフォルトはローカル開発用

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
      const rawData = event.data as string;
      const parsedData = JSON.parse(rawData);

      // サーバーからエラーメッセージが送られてきた場合の処理
      if (parsedData.error && typeof parsedData.error === 'string') {
        console.error('Server-side error:', parsedData.error);
        appendMessage({ speaker: 'System', text: `サーバーエラー: ${parsedData.error}`, timestamp: new Date().toISOString() });
        // エラーによってはボタンの状態をリセットするなどの処理も検討
        startButton.disabled = false;
        stopButton.disabled = true;
        startButton.style.display = 'block';
        stopButton.style.display = 'none';
        return;
      }

      // 通常のチャットメッセージとしてのバリデーションを強化
      if (typeof parsedData.speaker !== 'string' || typeof parsedData.text !== 'string' || typeof parsedData.timestamp !== 'string') {
        console.error('Invalid message format received:', parsedData);
        appendMessage({ speaker: 'System', text: '無効な形式のメッセージを受信しました。', timestamp: new Date().toISOString() });
        return;
      }

      const message = parsedData as ChatMessage; // 型アサーション
      const messageElement = appendMessage(message);

      if (message.speaker === 'System' &&
          (message.text === '会話が終了しました。' || // Generic end
           message.text.includes('応答取得に失敗しました') || // AI error
           message.text === '会話が手動で停止されました。' || // Manual stop by client
           message.text === '会話が停止されました。' || // Server-side stop (e.g. from DO stopConversation)
           message.text === '会話の最大ターン数に達しました。')) { // Max turns reached
        startButton.disabled = false;
        stopButton.disabled = true;
        startButton.style.display = 'block';
        stopButton.style.display = 'none';
      } else if (isAlvaOrBob(message.speaker) && messageElement) { // Use type guard and check if messageElement exists
        startButton.disabled = true;
        stopButton.disabled = false;
        startButton.style.display = 'none';
        stopButton.style.display = 'block';
        
        const speakerForAudio: 'ALVA' | 'Bob' = message.speaker;
        (async () => {
          await playMessageAudio(message.text, speakerForAudio);
          
          // Apply focus-out animation to the specific message element
          messageElement.classList.remove('text-focus-in');
          messageElement.classList.add('text-focus-out');

          // Also apply focus-out to the quote source element
          if (currentQuoteSourceElement) {
            currentQuoteSourceElement.classList.remove('text-focus-in');
            currentQuoteSourceElement.classList.add('text-focus-out');
          }
          
          // Remove the elements after the animation completes
          setTimeout(() => {
            messageElement.remove();
            // If quote source was animated out, ensure it's fully hidden/reset
            if (currentQuoteSourceElement) {
                // Check if it was the one associated with the removed message,
                // though for now, we assume it's always the current one.
                currentQuoteSourceElement.textContent = "";
                currentQuoteSourceElement.classList.remove('text-focus-out'); // Clean up class
                currentQuoteSourceElement.style.opacity = '0'; // Ensure hidden
                currentQuoteSourceElement.style.filter = 'blur(5px)'; // Reset to blurred state for next use
            }
          }, ANIMATION_DURATION); // ANIMATION_DURATION should match CSS

          if (socket && socket.readyState === WebSocket.OPEN) {
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

// const TYPEWRITER_DELAY = 30; // ms per character - Removed
const ANIMATION_DURATION = 700; // ms, should match CSS animation for focus-in/out

// Type guard to check if speaker is ALVA or Bob
function isAlvaOrBob(speaker: ChatMessage['speaker']): speaker is 'ALVA' | 'Bob' {
  return speaker === 'ALVA' || speaker === 'Bob';
}

// async function typewriterEffect(element: HTMLElement, text: string, cursor: HTMLElement, onComplete?: () => void) { ... } // Removed

function appendMessage(message: ChatMessage): HTMLDivElement | null { // Return the message element or null
  if (message.speaker === 'System') {
    if (systemMessageContainer) {
      // Clear previous system messages
      while (systemMessageContainer.firstChild) {
        systemMessageContainer.removeChild(systemMessageContainer.firstChild);
      }
      const systemMessageElement = document.createElement('div');
      systemMessageElement.classList.add('message', 'speaker-System');
      systemMessageElement.textContent = message.text || "システムメッセージ (テキストなし)"; // textがない場合のフォールバック
      systemMessageContainer.appendChild(systemMessageElement);
    } else {
      console.error("systemMessageContainer not found!");
    }
    return null; // System messages don't use the main chatArea animations
  }

  // message.text が undefined や null の場合のフォールバックを追加
  let messageTextContent = message.text || ""; // ここでフォールバック
  // Existing messages are not removed here anymore. They will be removed after TTS.

  // Clear and hide previous quote source - this might need rethinking if multiple messages are on screen.
  // For now, let's assume only one primary message's quote source is shown.
  if (currentQuoteSourceElement) {
    currentQuoteSourceElement.textContent = "";
    currentQuoteSourceElement.classList.remove('quote-source-animate'); // Or new focus animation class
    currentQuoteSourceElement.style.opacity = '0';
  }

  const messageElement = document.createElement('div');
  // Assign a unique ID to each message element for later reference (e.g., for removal)
  messageElement.id = `message-${message.timestamp}-${Math.random().toString(36).substring(2, 9)}`;
  messageElement.classList.add('message', `speaker-${message.speaker}`);

  const currentSpeaker = message.speaker;

  // let messageTextContent = message.text; // 上でフォールバック設定済み
  let displayAuthorName: string = currentSpeaker; // 初期値をスピーカー名に設定
  let extractedAuthorForBg: string | null = null;

  // 著者名抽出ロジックの改善
  let authorFound = false;
  
  // 末尾の句点やピリオドを削除するヘルパー関数
  const trimTrailingPunctuation = (str: string): string => {
    return str.replace(/[。\s.]+$/u, '');
  };

  // パターン1: 全角半角括弧 (著者名) 、末尾の句点も考慮
  let authorMatch = messageTextContent.match(/[(（]([^)）]+)[)）][\s。.]*$/u);
  if (authorMatch && authorMatch[1]) {
    extractedAuthorForBg = trimTrailingPunctuation(authorMatch[1].trim());
    displayAuthorName = extractedAuthorForBg;
    // messageTextContent から括弧と著者名、および末尾の句点等を除去
    messageTextContent = trimTrailingPunctuation(messageTextContent.substring(0, messageTextContent.lastIndexOf(authorMatch[0])).trim());
    authorFound = true;
  }

  // パターン2: エムダッシュ — 著者名 (括弧なし)、末尾の句点も考慮
  if (!authorFound) {
    // エムダッシュの後の文字列を著者名候補とし、そこから句点を除去
    authorMatch = messageTextContent.match(/(.*)—\s*([^\s\u2014.]+)([\s。.]*)$/u); // エムダッシュをUnicodeエスケープ
    if (authorMatch && authorMatch[2]) {
      const quoteBody = authorMatch[1].trim();
      extractedAuthorForBg = trimTrailingPunctuation(authorMatch[2].trim());
      displayAuthorName = extractedAuthorForBg;
      messageTextContent = trimTrailingPunctuation(quoteBody);
      authorFound = true;
    }
  }
  
  // パターン3: ハイフン - 著者名 (括弧なし)、末尾の句点も考慮
  if (!authorFound) {
    authorMatch = messageTextContent.match(/(.*)-\s*([^\s\-.]+)([\s。.]*)$/u); // ハイフンをエスケープ
     if (authorMatch && authorMatch[2]) {
      const quoteBody = authorMatch[1].trim();
      extractedAuthorForBg = trimTrailingPunctuation(authorMatch[2].trim());
      displayAuthorName = extractedAuthorForBg;
      messageTextContent = trimTrailingPunctuation(quoteBody);
      authorFound = true;
    }
  }

  if (!authorFound) {
    displayAuthorName = currentSpeaker; // どのパターンにも一致しない場合はスピーカー名
    extractedAuthorForBg = null; // 著者名が抽出できなかったことを示す
    messageTextContent = trimTrailingPunctuation(messageTextContent); // それでも本文末尾の句点は除去
  } else {
     // 著者名が抽出できた場合でも、残ったmessageTextContentの末尾句点を除去
     messageTextContent = trimTrailingPunctuation(messageTextContent);
  }


  if (backgroundLogElement) {
    let textForBackgroundLog = messageTextContent;
    if (extractedAuthorForBg) {
      textForBackgroundLog = `${messageTextContent} (${extractedAuthorForBg})`;
    }
    let logEntry = "";
    if (message.speaker === 'ALVA') {
      logEntry = `<span class="bg-log-alva">${textForBackgroundLog}</span> `;
    } else { // Bob
      logEntry = `${textForBackgroundLog} `;
    }
    fullConversationText += logEntry; // Prepend for right-to-left flow if needed, or append and rely on scroll
    
    // For vertical-rl with direction: rtl, new content should appear on the right.
    // innerHTML will re-render, consider appendChild with spans if performance is an issue.
    backgroundLogElement.innerHTML = fullConversationText; 
    
    // Scroll to the far right (which is the "start" or "newest" in vertical-rl with direction: rtl)
    backgroundLogElement.scrollLeft = 0; 
  }

  const quoteTextElement = document.createElement('p'); // Use <p> for the message text
  quoteTextElement.classList.add('quote-text');
  quoteTextElement.textContent = messageTextContent; // Set text directly

  messageElement.appendChild(quoteTextElement);
  chatArea.appendChild(messageElement);

  // Apply focus-in animation
  messageElement.classList.add('text-focus-in');

  // Update and show the dedicated quote source element
  // This will show the source for the LATEST message.
  if (currentQuoteSourceElement) {
    currentQuoteSourceElement.textContent = `— ${displayAuthorName}`;
    currentQuoteSourceElement.classList.remove('text-focus-out'); // Ensure no lingering out animation
    currentQuoteSourceElement.classList.add('text-focus-in'); // Apply focus-in animation
  }
  return messageElement; // Return the created message element
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
    message: text, // 元のAI応答テキストを使用
    stylebertvits2ModelId: speaker === 'ALVA' ? 5 : 1, // 文字列から数値に変更
    stylebertvits2SpeakerId: 0, // 文字列から数値に変更
    stylebertvits2SdpRatio: 0.2,
    stylebertvits2Noise: 0.6,
    stylebertvits2NoiseW: 0.8,
    stylebertvits2Length: 1.0,
    selectLanguage: 'ja',
    stylebertvits2AutoSplit: true, // 文字列 "true" からブール値 true に変更
    stylebertvits2SplitInterval: 0.5,
    stylebertvits2AssistTextWeight: 1,
    stylebertvits2Style: 'Neutral',
    stylebertvits2StyleWeight: 1,
  };

  try {
    const apiUrl = import.meta.env.VITE_API_BASE_URL || ''; // デフォルトは空文字、またはローカル開発用URL
    const response = await fetch(`${apiUrl}/api/tts`, {
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
  
  // WebSocketで会話開始をトリガー
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'START_CONVERSATION' }));
    appendMessage({ speaker: 'System', text: '会話開始リクエストを送信しました。', timestamp: new Date().toISOString() });
    // ボタンの状態はサーバーからの応答メッセージに基づいて更新されるため、ここでは直接変更しない
    // startButton.disabled = true;
    // stopButton.disabled = false;
    // startButton.style.display = 'none';
    // stopButton.style.display = 'block';
  } else {
    appendMessage({ speaker: 'System', text: 'WebSocketが接続されていません。会話を開始できません。', timestamp: new Date().toISOString() });
  }
});

stopButton.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'STOP_CONVERSATION' }));
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
