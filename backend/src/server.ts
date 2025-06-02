import express, { Request, Response } from 'express';
import http from 'http';
import WebSocket from 'ws';
import { body, validationResult } from 'express-validator'; // express-validatorをインポート
import dotenv from 'dotenv';
import path from 'path';
import { startConversation, getConversationHistory, stopConversation as stopConv, notifyAudioPlaybackComplete, handleClientDisconnect } from './conversationManager'; // notifyAudioPlaybackComplete, handleClientDisconnect をインポート
import { ChatMessage } from './types';

// dotenv.config({ path: path.join(__dirname, '..', '.env') }); // dotenv-cliを使用するため不要

const app = express();
app.use(express.json()); // JSONボディパーサーを追加
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// フロントエンドの静的ファイルを提供 (本番ビルド時)
// Viteで開発中はフロントエンド側で`vite dev`がポート5173などで実行されるため、
// バックエンドはAPIとWebSocketのみ担当。
// 本番用にビルドされたフロントエンドを配信する場合に以下の設定が役立つ。
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'));
  });
}


wss.on('connection', (ws) => {
  console.log('Client connected');

  // 接続時に現在の会話履歴を送信 (クライアントごとの履歴を取得)
  const history = getConversationHistory(ws);
  history.forEach(msg => ws.send(JSON.stringify(msg)));

  ws.on('message', (message) => {
    // クライアントからのメッセージは基本的には会話開始トリガーなど
    // 今回はシンプルに /start エンドポイントで開始する
    console.log(`Received message: ${message}`);
    try {
      const parsedMessage = JSON.parse(message.toString());
      if (parsedMessage.type === 'AUDIO_PLAYBACK_COMPLETE') {
        // parsedMessage.speaker の存在や型を検証
        if (typeof parsedMessage.speaker === 'string' && parsedMessage.speaker.trim() !== '') {
            console.log(`Received AUDIO_PLAYBACK_COMPLETE from client for speaker: ${parsedMessage.speaker}`);
            notifyAudioPlaybackComplete(ws); // wsオブジェクトを渡す
        } else {
            console.warn('Received AUDIO_PLAYBACK_COMPLETE with invalid or missing speaker.');
        }
      } else {
        // 従来の文字列ベースのメッセージも処理 (後方互換性のため)
        const messageString = message.toString();
        if (messageString === 'START_CONVERSATION') {
            startConversation(wss, ws); // ws を渡す
        } else if (messageString === 'STOP_CONVERSATION') {
            stopConv(wss, ws); // ws を渡す
        }
      }
    } catch (e) {
      // JSONパースに失敗した場合、文字列として処理
      const messageString = message.toString();
      if (messageString === 'START_CONVERSATION') {
          startConversation(wss, ws); // ws を渡す
      } else if (messageString === 'STOP_CONVERSATION') {
          stopConv(wss, ws); // ws を渡す
      } else {
        console.warn('Received non-JSON WebSocket message or unknown type:', messageString);
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleClientDisconnect(ws); // クライアント切断処理を呼び出す
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// REST APIエンドポイント (会話開始など)
// このエンドポイントは特定のクライアントを指定できないため、WebSocket経由での開始を推奨
app.post('/start-conversation', (req, res) => {
  // startConversation(wss); // 特定のクライアントなしに会話を開始するのは不適切
  console.warn('/start-conversation API endpoint called, but it does not start a conversation for a specific client. Use WebSocket "START_CONVERSATION" message instead.');
  res.status(400).send({ message: 'This endpoint is deprecated. Please use WebSocket message "START_CONVERSATION" to start a conversation for the connected client.' });
});

// TTS API Endpoint
const getLanguageCode = (selectLanguage: string): string => {
  switch (selectLanguage) {
    case 'ja':
      return 'JP';
    case 'en':
      return 'EN';
    case 'zh':
      return 'ZH';
    default:
      return 'EN';
  }
};

app.post('/api/tts',
  // バリデーションルールの定義
  body('message').isString().notEmpty().withMessage('Message is required and must be a string.'),
  body('stylebertvits2ModelId').optional().isInt({ min: 0 }).withMessage('Model ID must be a non-negative integer.'),
  body('stylebertvits2SpeakerId').optional().isInt({ min: 0 }).withMessage('Speaker ID must be a non-negative integer.'),
  body('stylebertvits2ServerUrl').optional().isURL().withMessage('Server URL must be a valid URL.'),
  body('stylebertvits2ApiKey').optional().isString().withMessage('API Key must be a string.'),
  body('stylebertvits2Style').optional().isString().withMessage('Style must be a string.'),
  body('stylebertvits2SdpRatio').optional().isFloat({ min: 0, max: 1 }).withMessage('SDP Ratio must be a float between 0 and 1.'),
  body('stylebertvits2Noise').optional().isFloat({ min: 0, max: 1 }).withMessage('Noise must be a float between 0 and 1.'),
  body('stylebertvits2NoiseW').optional().isFloat({ min: 0, max: 2 }).withMessage('NoiseW must be a float between 0 and 2.'), // 例: 範囲は適宜調整
  body('stylebertvits2Length').optional().isFloat({ min: 0.1, max: 5 }).withMessage('Length must be a float between 0.1 and 5.'), // 例: 範囲は適宜調整
  body('selectLanguage').isIn(['ja', 'en', 'zh']).withMessage('Select Language must be one of ja, en, zh.'),
  body('stylebertvits2AutoSplit').optional().isBoolean().withMessage('Auto Split must be a boolean.'),
  body('stylebertvits2SplitInterval').optional().isFloat({ min: 0.1 }).withMessage('Split Interval must be a positive float.'),
  body('stylebertvits2AssistTextWeight').optional().isFloat({ min: 0, max: 1 }).withMessage('Assist Text Weight must be a float between 0 and 1.'),
  body('stylebertvits2StyleWeight').optional().isFloat({ min: 0, max: 1 }).withMessage('Style Weight must be a float between 0 and 1.'),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const body = req.body;
    const message = body.message;
  const stylebertvits2ModelId = body.stylebertvits2ModelId;
  const stylebertvits2SpeakerId = body.stylebertvits2SpeakerId; // New
  const stylebertvits2ServerUrl =
    body.stylebertvits2ServerUrl || process.env.STYLEBERTVITS2_SERVER_URL;
  
  const cfAccessClientId = process.env.STYLEBERTVITS2_CLIENT_ID;
  const cfAccessClientSecret = process.env.STYLEBERTVITS2_API_KEY; 

  const stylebertvits2ApiKey =
    body.stylebertvits2ApiKey || process.env.STYLEBERTVITS2_API_KEY;
    
  const stylebertvits2Style = body.stylebertvits2Style;
  const stylebertvits2SdpRatio = body.stylebertvits2SdpRatio;
  const stylebertvits2Noise = body.stylebertvits2Noise; // New
  const stylebertvits2NoiseW = body.stylebertvits2NoiseW; // New
  const stylebertvits2Length = body.stylebertvits2Length;
  const selectLanguage = getLanguageCode(body.selectLanguage);
  const stylebertvits2AutoSplit = body.stylebertvits2AutoSplit; // New
  const stylebertvits2SplitInterval = body.stylebertvits2SplitInterval; // New
  const stylebertvits2AssistTextWeight = body.stylebertvits2AssistTextWeight; // New
  const stylebertvits2StyleWeight = body.stylebertvits2StyleWeight; // New


  if (!stylebertvits2ServerUrl) {
    return res.status(500).json({ error: 'STYLEBERTVITS2_SERVER_URL is not configured.' });
  }

  try {
    const commonHeaders: HeadersInit = {};
    if (cfAccessClientId && cfAccessClientSecret) {
      commonHeaders['CF-Access-Client-Id'] = cfAccessClientId;
      commonHeaders['CF-Access-Client-Secret'] = cfAccessClientSecret;
    }

    if (!stylebertvits2ServerUrl.includes('https://api.runpod.ai')) {
      const queryParams = new URLSearchParams({
        text: message,
        model_id: stylebertvits2ModelId,
        speaker_id: stylebertvits2SpeakerId, // Added
        sdp_ratio: stylebertvits2SdpRatio.toString(),
        noise: stylebertvits2Noise.toString(), // Added
        noisew: stylebertvits2NoiseW.toString(), // Added
        length: stylebertvits2Length.toString(),
        language: selectLanguage,
        auto_split: stylebertvits2AutoSplit, // Added
        split_interval: stylebertvits2SplitInterval.toString(), // Added
        assist_text_weight: stylebertvits2AssistTextWeight.toString(), // Added
        style: stylebertvits2Style,
        style_weight: stylebertvits2StyleWeight.toString(), // Added
      });

      const voiceResponse = await fetch(
        `${stylebertvits2ServerUrl.replace(/\/$/, '')}/voice?${queryParams}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'audio/wav',
            ...commonHeaders,
          },
        }
      );

      if (!voiceResponse.ok) {
        const errorText = await voiceResponse.text();
        console.error(`TTS Server Error: ${voiceResponse.status}`, errorText); // 詳細ログ
        // クライアントには汎用的なメッセージを返す
        throw new Error(
          `TTS処理中にエラーが発生しました。しばらくしてから再度お試しください。`
        );
      }

      const arrayBuffer = await voiceResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    } else { // runpod.ai の場合
      const headersForRunpod: HeadersInit = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stylebertvits2ApiKey}`,
        ...commonHeaders,
      };

      const voiceResponse = await fetch(
        `${stylebertvits2ServerUrl.replace(/\/$/, '')}`,
        {
          method: 'POST',
          headers: headersForRunpod,
          body: JSON.stringify({
            input: {
              action: '/voice',
              model_id: stylebertvits2ModelId,
              speaker_id: stylebertvits2SpeakerId, // Added
              text: message,
              style: stylebertvits2Style,
              sdp_ratio: stylebertvits2SdpRatio,
              noise: stylebertvits2Noise, // Added
              noisew: stylebertvits2NoiseW, // Added
              length: stylebertvits2Length,
              language: selectLanguage,
              auto_split: stylebertvits2AutoSplit, // Added
              split_interval: stylebertvits2SplitInterval, // Added
              assist_text_weight: stylebertvits2AssistTextWeight, // Added
              style_weight: stylebertvits2StyleWeight, // Added
            },
          }),
        }
      );

      if (!voiceResponse.ok) {
        const errorText = await voiceResponse.text();
        console.error(`TTS Server Error (Runpod): ${voiceResponse.status}`, errorText); // 詳細ログ
        // クライアントには汎用的なメッセージを返す
        throw new Error(
          `TTS処理中にエラーが発生しました。しばらくしてから再度お試しください。`
        );
      }

      const voiceData = await voiceResponse.json();
      if (voiceData.output && voiceData.output.voice) {
        const base64Audio = voiceData.output.voice;
        const buffer = Buffer.from(base64Audio, 'base64');

        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': buffer.length,
        });
        res.end(buffer);
      } else {
        console.error('Runpod TTS response does not contain output.voice', voiceData);
        throw new Error('Runpod TTSからの応答形式が不正です。');
      }
    }
  } catch (error: any) {
    console.error('TTS Error:', error); // 詳細ログ
    // クライアントには汎用的なメッセージ
    res.status(500).json({ error: 'TTSリクエストの処理中に内部エラーが発生しました。' });
  }
});


server.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});
