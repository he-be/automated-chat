import express, { Request, Response } from 'express';
import http from 'http';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { startConversation, getConversationHistory, stopConversation as stopConv } from './conversationManager'; // stopConversationをインポート
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

  // 接続時に現在の会話履歴を送信
  const history = getConversationHistory();
  history.forEach(msg => ws.send(JSON.stringify(msg)));

  ws.on('message', (message) => {
    // クライアントからのメッセージは基本的には会話開始トリガーなど
    // 今回はシンプルに /start エンドポイントで開始する
    console.log(`Received message: ${message}`);
    const messageString = message.toString();
    if (messageString === 'START_CONVERSATION') {
        startConversation(wss);
    } else if (messageString === 'STOP_CONVERSATION') {
        stopConv(wss); // インポートした関数を使用
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// REST APIエンドポイント (会話開始など)
app.post('/start-conversation', (req, res) => {
  startConversation(wss);
  res.status(200).send({ message: 'Conversation started' });
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

app.post('/api/tts', async (req: Request, res: Response) => {
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
        console.error(`TTS Server Error: ${voiceResponse.status}`, errorText);
        throw new Error(
          `サーバーからの応答が異常です。ステータスコード: ${voiceResponse.status}. ${errorText}`
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
        console.error(`TTS Server Error (Runpod): ${voiceResponse.status}`, errorText);
        throw new Error(
          `サーバーからの応答が異常です。ステータスコード: ${voiceResponse.status}. ${errorText}`
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
    console.error('TTS Error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});


server.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});
