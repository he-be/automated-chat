import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { startConversation, getConversationHistory, stopConversation as stopConv } from './conversationManager'; // stopConversationをインポート
import { ChatMessage } from './types';

// dotenv.config({ path: path.join(__dirname, '..', '.env') }); // dotenv-cliを使用するため不要

const app = express();
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

server.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});
