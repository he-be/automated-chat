# Automated Chat Application

AI同士が文学的な引用のみで会話を行う、哲学的対話アプリケーション

## 🎯 プロジェクト概要

このアプリケーションは、2つのAIエージェント（ALVAとBob）が文学的引用のみを使って自動対話を行うWebアプリケーションです。各メッセージは音声合成され、日本語の縦書きレイアウトで美しく表示されます。

### 主な機能

- **AI自動会話**: 2つの異なる性格のAIが文学的引用で対話
- **リアルタイム通信**: WebSocketによるライブ更新
- **音声合成**: StyleBertVITS2による高品質なTTS
- **縦書きUI**: 日本語的な美しい縦書きレイアウト
- **レスポンシブデザイン**: モバイル対応

## 🏗️ アーキテクチャ

```
automated-chat/
├── frontend/           # フロントエンド (Vite + TypeScript)
├── backend/           # Express.js サーバー
├── backend-worker-app/ # Cloudflare Workers 実装
└── package.json       # ルートパッケージ設定
```

## 🤖 AIエージェント

### ALVA (エージェントA)
- **特徴**: 脱意味的引用を行う抽象的AI
- **性格**: 冷静、客観的、意外性のある引用を提供
- **音声**: 女性声（Model ID: 4）

### Bob (エージェントB) 
- **特徴**: 人間らしい感情的反応を示すAI
- **性格**: 共感的、好奇心旺盛、ALVAの抽象的な引用に困惑
- **音声**: 男性声（Model ID: 1）

## 🛠️ 技術スタック

### フロントエンド
- **フレームワーク**: Vite + TypeScript
- **スタイリング**: Custom CSS (縦書き対応)
- **通信**: WebSocket
- **音声**: Web Audio API

### バックエンド (2つの実装)

#### Express.js版 (`/backend`)
- **ランタイム**: Node.js + TypeScript  
- **フレームワーク**: Express.js
- **WebSocket**: ws ライブラリ
- **AI**: Google Gemini AI (gemini-2.0-flash)

#### Cloudflare Workers版 (`/backend-worker-app`)
- **ランタイム**: Cloudflare Workers
- **フレームワーク**: Hono
- **状態管理**: Durable Objects
- **AI**: Google Gemini AI (gemini-2.0-flash-lite)

### 外部サービス
- **Google Gemini AI**: 文学的引用生成
- **StyleBertVITS2**: 高品質音声合成

## 🚀 デプロイ方法

### 1. バックエンド (Cloudflare Workers)

```bash
cd backend-worker-app

# 環境変数設定
wrangler secret put GEMINI_API_KEY
wrangler secret put STYLEBERTVITS2_API_KEY
wrangler secret put STYLEBERTVITS2_CLIENT_ID
wrangler secret put STYLEBERTVITS2_SERVER_URL

# デプロイ
npm run deploy
```

### 2. フロントエンド (Cloudflare Pages)

#### Git連携による自動デプロイ
1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. GitHubリポジトリを選択: `automated-chat`
4. ビルド設定:
   ```
   Build command: cd frontend && npm install && npm run build
   Build output directory: frontend/dist
   Root directory: (空白のまま)
   ```
5. 環境変数設定:
   ```
   VITE_WS_URL=wss://backend-worker-app.masahiro-hibi.workers.dev/websocket
   ```

#### 手動デプロイ
```bash
# ビルド
VITE_WS_URL=wss://backend-worker-app.masahiro-hibi.workers.dev/websocket npm run build

# デプロイ
npx wrangler pages deploy dist --project-name automated-chat
```

## 🌍 デプロイ先

- **フロントエンド**: Cloudflare Pages
  - URL: `https://automated-chat.pages.dev`
- **バックエンド**: Cloudflare Workers  
  - URL: `https://backend-worker-app.masahiro-hibi.workers.dev`

## ⚙️ 環境変数

### バックエンド (Workers Secrets)
```bash
GEMINI_API_KEY=your_gemini_api_key
STYLEBERTVITS2_SERVER_URL=https://tts.do-not-connect.com
STYLEBERTVITS2_API_KEY=your_tts_api_key
STYLEBERTVITS2_CLIENT_ID=your_cloudflare_client_id
```

### フロントエンド (Pages Environment Variables)
```bash
VITE_WS_URL=wss://backend-worker-app.masahiro-hibi.workers.dev/websocket
```

## 🔌 API仕様

### WebSocket
- **エンドポイント**: `/websocket`
- **メッセージ**:
  - `START_CONVERSATION`: 会話開始
  - `STOP_CONVERSATION`: 会話停止
  - `AUDIO_PLAYBACK_COMPLETE`: 音声再生完了通知

### REST API
- **POST /api/tts**: テキスト音声合成
  - パラメータ: message, model_id, speaker_id等

## 🏃‍♂️ ローカル開発

```bash
# 依存関係インストール
npm install

# バックエンド起動 (Workers版)
cd backend-worker-app
npm run dev

# フロントエンド起動
cd frontend  
npm run dev
```

## 📁 主要ファイル

- `frontend/src/main.ts`: フロントエンドメインロジック
- `backend-worker-app/src/index.ts`: Workers メインハンドラ
- `backend-worker-app/wrangler.jsonc`: Workers設定
- `frontend/vite.config.ts`: Vite設定

## 🎨 UI特徴

- **縦書きレイアウト**: `writing-mode: vertical-rl`
- **日本語フォント**: Mincho系フォント
- **グレースケール**: 落ち着いた色調
- **アニメーション**: フォーカス時のブラー効果
- **レスポンシブ**: モバイル対応

## 🤝 会話フロー

1. WebSocket接続確立
2. `START_CONVERSATION`メッセージ送信
3. AI同士が交互に文学的引用で会話 (最大10ターン)
4. 各メッセージの音声合成・再生
5. 会話完了または手動停止

---

*このアプリケーションは、AI、文学、音声合成技術を組み合わせた実験的な対話体験を提供します。*