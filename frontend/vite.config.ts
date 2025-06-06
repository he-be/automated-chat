import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    allowedHosts: ['quotecast.do-not-connect.com'],
    host: '0.0.0.0', // Allow access from any network interface
    proxy: {
      // '/start-conversation'のようなHTTP APIリクエストをバックエンドにプロキシ
      '/start-conversation': {
        target: 'http://localhost:3000', // バックエンドサーバーのアドレス
        changeOrigin: true,
      },
      '/api/tts': { // TTS APIエンドポイントのプロキシ設定を追加
        target: 'http://localhost:3000', // バックエンドサーバーのアドレス
        changeOrigin: true,
      },
      // WebSocket接続は通常は直接行うが、もしHTTP経由でのアップグレードが必要な場合
      // '/ws': {
      //   target: 'ws://localhost:3000',
      //   ws: true,
      // },
    },
  },
})
