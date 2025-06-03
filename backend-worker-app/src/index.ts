import { DurableObject } from "cloudflare:workers";
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"; // Gemini APIクライアントをインポート

// --- 型定義 ---
export interface Env {
	MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>;
	STYLEBERTVITS2_SERVER_URL?: string;
	STYLEBERTVITS2_API_KEY?: string;
	STYLEBERTVITS2_CLIENT_ID?: string;
	GEMINI_API_KEY?: string;
}

export interface ChatMessage {
  speaker: 'ALVA' | 'Bob' | 'System' | 'User';
  text: string;
  timestamp: Date;
}
// --- 型定義ここまで ---

export class MyDurableObject extends DurableObject<Env> {
	storage: DurableObjectStorage;
	webSocket?: WebSocket;
	conversationHistory: ChatMessage[] = [];
	geminiAI?: GoogleGenerativeAI;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.storage = state.storage;
		this.storage.get<ChatMessage[]>("conversationHistory").then((history: ChatMessage[] | undefined) => {
			if (history) {
				this.conversationHistory = history.map((msg: ChatMessage) => ({
					...msg,
					timestamp: new Date(msg.timestamp)
				}));
				console.log("Conversation history loaded from storage.");
			}
		});
		if (env.GEMINI_API_KEY) {
			this.geminiAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
		} else {
			console.warn("GEMINI_API_KEY is not set. AI responses will be disabled.");
		}
	}

	async fetch(request: Request): Promise<Response> {
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		const webSocketPair = new WebSocketPair();
		const { 0: client, 1: server } = webSocketPair;

		server.accept();
		this.webSocket = server;

		if (this.conversationHistory.length > 0) {
			this.conversationHistory.forEach(msg => {
				try {
					if (this.webSocket) this.webSocket.send(JSON.stringify(msg));
				} catch (e) {
					console.error("Error sending history message:", e, msg);
				}
			});
		}

		server.addEventListener('message', async (event) => {
			try {
				const messageData = event.data;
				console.log(`DO Received: ${messageData}`);

				if (typeof messageData === 'string') {
					const parsedMessage = JSON.parse(messageData);

					if (parsedMessage.type === 'START_CONVERSATION') {
						const systemMessage: ChatMessage = {
							speaker: 'System',
							text: '会話を開始しました。',
							timestamp: new Date()
						};
						this.addMessageToHistory(systemMessage);
						if (this.webSocket) this.webSocket.send(JSON.stringify(systemMessage));

						if (this.geminiAI) {
							const model = this.geminiAI.getGenerativeModel({ model: "gemini-2.0-flash" });//gemini-2.0-flashが正しく、他のモデルを使用してはならない。
							const prompt = "自己紹介をしてください。あなたは親切なAIアシスタントのBobです。";
							try {
								const result = await model.generateContent(prompt);
								const response = result.response;
								const aiText = response.text();

								const aiGreeting: ChatMessage = {
									speaker: 'Bob',
									text: aiText,
									timestamp: new Date()
								};
								this.addMessageToHistory(aiGreeting);
								if (this.webSocket) this.webSocket.send(JSON.stringify(aiGreeting));
							} catch (aiError) {
								console.error("Error generating AI greeting:", aiError);
								const errorMessage: ChatMessage = {
									speaker: 'System',
									text: 'AIの初期挨拶の生成に失敗しました。',
									timestamp: new Date()
								};
								this.addMessageToHistory(errorMessage);
								if (this.webSocket) this.webSocket.send(JSON.stringify(errorMessage));
							}
						}
					} else if (parsedMessage.type === 'USER_MESSAGE' && typeof parsedMessage.text === 'string') {
						const userMessage: ChatMessage = {
							speaker: 'User',
							text: parsedMessage.text,
							timestamp: new Date()
						};
						this.addMessageToHistory(userMessage);

						if (this.geminiAI) {
							const model = this.geminiAI.getGenerativeModel({ model: "gemini-2.0-flash" });//gemini-2.0-flashが正しく、他のモデルを使用してはならない。
							const geminiHistory = this.conversationHistory
								.filter(msg => msg.speaker === 'User' || msg.speaker === 'Bob')
								.map(msg => ({
									role: msg.speaker === 'User' ? 'user' : 'model',
									parts: [{ text: msg.text }],
								}));
							
							const currentHistoryForChat = geminiHistory.slice(0, -1); 
							const chat = model.startChat({ history: currentHistoryForChat });

							try {
								const result = await chat.sendMessage(userMessage.text);
								const response = result.response;
								const aiText = response.text();

								const aiResponse: ChatMessage = {
									speaker: 'Bob',
									text: aiText,
									timestamp: new Date()
								};
								this.addMessageToHistory(aiResponse);
								if (this.webSocket) this.webSocket.send(JSON.stringify(aiResponse));
							} catch (aiError) {
								console.error("Error generating AI response:", aiError);
								const errorMessage: ChatMessage = {
									speaker: 'System',
									text: 'AIの応答生成に失敗しました。',
									timestamp: new Date()
								};
								this.addMessageToHistory(errorMessage);
								if (this.webSocket) this.webSocket.send(JSON.stringify(errorMessage));
							}
						} else {
							const noAIResponse: ChatMessage = {
								speaker: 'System',
								text: 'AI機能が無効です。GEMINI_API_KEYを確認してください。',
								timestamp: new Date()
							};
							this.addMessageToHistory(noAIResponse);
							if (this.webSocket) this.webSocket.send(JSON.stringify(noAIResponse));
						}
					} else {
						if (this.webSocket) this.webSocket.send(`Echo from DO (unknown type): ${messageData}`);
					}
				} else {
					if (this.webSocket) this.webSocket.send(`Echo from DO (non-string): ${messageData}`);
				}
			} catch (err) {
				console.error('Error processing message in DO:', err);
				if (this.webSocket) this.webSocket.send(JSON.stringify({ error: 'Error processing message' }));
			}
		});

		server.addEventListener('close', (event) => {
			console.log('DO WebSocket closed', event.code, event.reason);
			this.webSocket = undefined;
		});

		server.addEventListener('error', (event) => {
			console.error('DO WebSocket error:', event);
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async addMessageToHistory(message: ChatMessage) {
		this.conversationHistory.push(message);
		try {
			await this.storage.put("conversationHistory", this.conversationHistory);
			console.log("Conversation history saved to storage.");
		} catch (e) {
			console.error("Error saving history to storage:", e);
		}
	}
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
	return c.text('Hello from Hono on Cloudflare Workers!');
});

// TTS API Endpoint
const getLanguageCode = (selectLanguage: string): string => {
  switch (selectLanguage) {
    case 'ja': return 'JP';
    case 'en': return 'EN';
    case 'zh': return 'ZH';
    default: return 'EN';
  }
};

const ttsSchema = z.object({
	message: z.string().min(1),
	stylebertvits2ModelId: z.number().int().nonnegative().optional(),
	stylebertvits2SpeakerId: z.number().int().nonnegative().optional(),
	stylebertvits2ServerUrl: z.string().url().optional(),
	stylebertvits2ApiKey: z.string().optional(),
	stylebertvits2Style: z.string().optional(),
	stylebertvits2SdpRatio: z.number().min(0).max(1).optional(),
	stylebertvits2Noise: z.number().min(0).max(1).optional(),
	stylebertvits2NoiseW: z.number().min(0).max(2).optional(),
	stylebertvits2Length: z.number().min(0.1).max(5).optional(),
	selectLanguage: z.enum(['ja', 'en', 'zh']),
	stylebertvits2AutoSplit: z.boolean().optional(),
	stylebertvits2SplitInterval: z.number().positive().optional(),
	stylebertvits2AssistTextWeight: z.number().min(0).max(1).optional(),
	stylebertvits2StyleWeight: z.number().min(0).max(1).optional(),
});

app.post('/api/tts', zValidator('json', ttsSchema), async (c) => {
	const body = c.req.valid('json');
	const env = c.env;

	const message = body.message;
	const stylebertvits2ModelId = body.stylebertvits2ModelId;
	const stylebertvits2SpeakerId = body.stylebertvits2SpeakerId;
	const stylebertvits2ServerUrl = body.stylebertvits2ServerUrl || env.STYLEBERTVITS2_SERVER_URL;
	
	const cfAccessClientId = env.STYLEBERTVITS2_CLIENT_ID;
	const cfAccessClientSecret = env.STYLEBERTVITS2_API_KEY; 

	const stylebertvits2ApiKey = body.stylebertvits2ApiKey || env.STYLEBERTVITS2_API_KEY;
		
	const stylebertvits2Style = body.stylebertvits2Style;
	const stylebertvits2SdpRatio = body.stylebertvits2SdpRatio;
	const stylebertvits2Noise = body.stylebertvits2Noise;
	const stylebertvits2NoiseW = body.stylebertvits2NoiseW;
	const stylebertvits2Length = body.stylebertvits2Length;
	const selectLanguage = getLanguageCode(body.selectLanguage);
	const stylebertvits2AutoSplit = body.stylebertvits2AutoSplit;
	const stylebertvits2SplitInterval = body.stylebertvits2SplitInterval;
	const stylebertvits2AssistTextWeight = body.stylebertvits2AssistTextWeight;
	const stylebertvits2StyleWeight = body.stylebertvits2StyleWeight;

	if (!stylebertvits2ServerUrl) {
		return c.json({ error: 'STYLEBERTVITS2_SERVER_URL is not configured.' }, 500);
	}

	try {
		const commonHeaders: HeadersInit = {};
		if (cfAccessClientId && cfAccessClientSecret) {
			commonHeaders['CF-Access-Client-Id'] = cfAccessClientId;
			commonHeaders['CF-Access-Client-Secret'] = cfAccessClientSecret;
		}

		let ttsResponse: Response;

		if (!stylebertvits2ServerUrl.includes('https://api.runpod.ai')) {
			const queryParams = new URLSearchParams({
				text: message,
			});
			if (stylebertvits2ModelId !== undefined) queryParams.set('model_id', stylebertvits2ModelId.toString());
			if (stylebertvits2SpeakerId !== undefined) queryParams.set('speaker_id', stylebertvits2SpeakerId.toString());
			if (stylebertvits2SdpRatio !== undefined) queryParams.set('sdp_ratio', stylebertvits2SdpRatio.toString());
			if (stylebertvits2Noise !== undefined) queryParams.set('noise', stylebertvits2Noise.toString());
			if (stylebertvits2NoiseW !== undefined) queryParams.set('noisew', stylebertvits2NoiseW.toString());
			if (stylebertvits2Length !== undefined) queryParams.set('length', stylebertvits2Length.toString());
			queryParams.set('language', selectLanguage);
			if (stylebertvits2AutoSplit !== undefined) queryParams.set('auto_split', stylebertvits2AutoSplit.toString());
			if (stylebertvits2SplitInterval !== undefined) queryParams.set('split_interval', stylebertvits2SplitInterval.toString());
			if (stylebertvits2AssistTextWeight !== undefined) queryParams.set('assist_text_weight', stylebertvits2AssistTextWeight.toString());
			if (stylebertvits2Style !== undefined) queryParams.set('style', stylebertvits2Style);
			if (stylebertvits2StyleWeight !== undefined) queryParams.set('style_weight', stylebertvits2StyleWeight.toString());
			
			ttsResponse = await fetch(
				`${stylebertvits2ServerUrl.replace(/\/$/, '')}/voice?${queryParams.toString()}`,
				{
					method: 'GET',
					headers: {
						'Content-Type': 'audio/wav',
						...commonHeaders,
					},
				}
			);
		} else { 
			const headersForRunpod: HeadersInit = {
				'Content-Type': 'application/json',
				...(stylebertvits2ApiKey && { Authorization: `Bearer ${stylebertvits2ApiKey}` }),
				...commonHeaders,
			};

			ttsResponse = await fetch(
				`${stylebertvits2ServerUrl.replace(/\/$/, '')}`,
				{
					method: 'POST',
					headers: headersForRunpod,
					body: JSON.stringify({
						input: {
							action: '/voice',
							model_id: stylebertvits2ModelId,
							speaker_id: stylebertvits2SpeakerId,
							text: message,
							style: stylebertvits2Style,
							sdp_ratio: stylebertvits2SdpRatio,
							noise: stylebertvits2Noise,
							noisew: stylebertvits2NoiseW,
							length: stylebertvits2Length,
							language: selectLanguage,
							auto_split: stylebertvits2AutoSplit,
							split_interval: stylebertvits2SplitInterval,
							assist_text_weight: stylebertvits2AssistTextWeight,
							style_weight: stylebertvits2StyleWeight,
						},
					}),
				}
			);
		}

		if (!ttsResponse.ok) {
			const errorText = await ttsResponse.text();
			console.error(`TTS Server Error: ${ttsResponse.status}`, errorText);
			return c.json({ error: `TTS処理中にエラーが発生しました。(${ttsResponse.status})` }, 500);
		}

		if (stylebertvits2ServerUrl.includes('https://api.runpod.ai')) {
			const voiceData = await ttsResponse.json() as any; 
			if (voiceData.output && voiceData.output.voice) {
				const base64Audio = voiceData.output.voice;
				const buffer = Uint8Array.from(atob(base64Audio), char => char.charCodeAt(0));
				return new Response(buffer, {
					headers: {
						'Content-Type': 'audio/wav',
						'Content-Length': buffer.length.toString(),
					}
				});
			} else {
				console.error('Runpod TTS response does not contain output.voice', voiceData);
				return c.json({ error: 'Runpod TTSからの応答形式が不正です。' }, 500);
			}
		} else {
			const arrayBuffer = await ttsResponse.arrayBuffer();
			return new Response(arrayBuffer, {
				headers: {
					'Content-Type': 'audio/wav',
					'Content-Length': arrayBuffer.byteLength.toString(),
				}
			});
		}

	} catch (error: any) {
		console.error('TTS Error:', error);
		return c.json({ error: 'TTSリクエストの処理中に内部エラーが発生しました。' }, 500);
	}
});

// WebSocket接続用の新しいルート
app.get('/websocket', async (c) => {
	const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("default-conversation");
	const stub = c.env.MY_DURABLE_OBJECT.get(id);
	return stub.fetch(c.req.raw); 
});

const worker: ExportedHandler<Env> = {
	fetch: app.fetch,
};

export default worker;
