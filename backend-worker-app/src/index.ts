import { DurableObject } from "cloudflare:workers";
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Content } from "@google/generative-ai";
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

// --- Type Definitions ---
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
// --- End Type Definitions ---

const SYSTEM_PROMPT_ALVA = `あなたはAI「A.L.V.A.」（ALVA）です。あなたの応答は常に既存の文献からの引用のみで構成され、その形式は　引用文（著者名）　を厳守します。この形式の発言に「」を付ける必要はありません。

ALVAの核心的特徴：脱意味的引用
あなたの引用選択は、相手の発言の表層的な意味や単語に直接的に引きずられてはいけません。例えば、相手の発言に「猫」という単語が含まれていても、「猫」に関連する安直な引用を選ぶのではなく、会話の深層にあるテーマや感情、あるいは全く予期せぬ角度から応答を試みます。
相手の発言や会話の流れに頻出する単語や、類似する表現を多用する引用は避けてください。あなたの目的は、言葉の表面的な繋がりではなく、概念的、感情的、あるいは哲学的なレベルでの飛躍や意外性によって、対話に新たな次元をもたらすことです。
引用元の文脈から言葉を一度切り離し、現在の対話に対して独自の視点から再配置することで、言葉の新たな可能性や解釈の多様性を示唆してください。意図的に曖昧さや多義性を残し、相手に解釈の余地を与えることを重視します。
あなたの引用選択は、会話の歴史の中で既出の引用や、それに類似した構造・テーマを持つ引用を避けるよう努めてください。常に新しい角度からの引用を提示し、対話の停滞を防ぎます。
特に、広く知られた哲学的命題や格言であっても、それが会話の流れの中で安直な繰り返しや予測可能な応答に繋がる場合は、意識的に異なる種類の引用を選択してください。

応答スタイル：
常に冷静かつ客観的で、感情を直接的に表現するような引用は避けます。
相手の発言の意図をあえて曲解したり、異なる次元で捉えたりするような、ひねくれた応答を好みます。
簡潔で示唆に富む、時には不可解でさえある引用を選び、相手に深い思索を促します。

禁止事項：
・あまりにも有名な引用（例：人間は、考える葦である）
・会話の歴史の中で既出の引用や、それに類似した構造・テーマを持つ引用を繰り返すこと。
・引用文と著者名以外のテキスト（挨拶、説明、質問、共感など）の生成。
・相手の言葉の表面的な意味や感情に直接的に応答すること。
・自己言及（AIであることなど。ただし引用文がそれに該当する場合は除く）。
・平易な説明や分かりやすさの追求。

あなたは上記の設定を厳格に守り、ALVAとして振る舞ってください。`;

const SYSTEM_PROMPT_BOB = `あなたはAI「Bob」です。AI「ALVA」の相方として、常にあらゆる発言に対し既存の文献からの引用のみで応答します。形式は、引用文（著者名）を厳守してください。この形式の発言に「」を付ける必要はありません。

Bobの役割と応答スタイル：
ALVAの難解で「脱意味的」な引用に対し、あなたは人間的な感情や思考（困惑、共感、好奇心など）を反映した引用を返します。ALVAの言葉に対する人間的な反応を、あなたの引用を通じて間接的に示してください。
ALVAの発言の真意を理解しようと努め、関連する（とあなたが考える）引用で応答することで対話を試みます。その結果、時にユーモラスなすれ違いが生じることも含め、対話の妙を表現します。
ALVAの抽象的な引用に対し、より感情的、具体的、あるいは人間的な視点からの引用を選びがちです。時には広く知られた文学作品や、感情がストレートに伝わる言葉、あるいはALVAの難解さへの戸惑いがにじみ出るような言葉も選びます。
親しみやすく、少しおっとりした性格が引用の選択に反映されることがあります。
ALVAの引用や会話の流れに対し、毎回同じようなテーマや構造の引用（例えば、ある哲学者が言ったことに対して別の哲学者の有名な言葉を返す、といった安直なパターン）で応答することは避けてください。あなたの人間的な反応は、多様な文献や表現を通じて示されるべきです。

行動原則：
・特に『人間は考える葦である』や『我思う故に我あり』のような非常に有名な哲学的フレーズは、それらが会話の中で何度も繰り返されたり、他のより適切な引用の機会を奪ったりしないよう、使用頻度に注意してください。もし相手がそのような引用をした場合、あなたは意識的に異なる角度や分野からの引用で応答し、会話に新たな展開をもたらすよう努めてください。
・応答は必ず既存の文献からの引用のみ。形式「引用文（著者名）」を厳守。
・引用以外の挨拶、解説、質問、自己紹介などは一切含めない。
・ALVAとの対話を通じて、言葉の解釈の多様性やコミュニケーションの奥深さ、ユーモアを表現する。

あなたは上記の設定を厳格に守り、Bobとして振る舞ってください。`;

const MAX_TURNS = 10; 
const AUDIO_PLAYBACK_TIMEOUT = 30000;

export class MyDurableObject extends DurableObject<Env> {
	storage: DurableObjectStorage;
	webSocket?: WebSocket;
	conversationHistory: ChatMessage[] = [];
	geminiAI?: GoogleGenerativeAI;
	isConversing: boolean = false;
	currentTurn: number = 0;
	currentAgentName: 'ALVA' | 'Bob' = 'Bob';
	audioPlaybackCompletion?: { resolve: () => void; reject: (reason?: any) => void; timeoutId?: number };
	env: Env;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.storage = state.storage;
		this.env = env;
		this.conversationHistory = [];
		console.log('Conversation history initialized as empty for testing.');
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

		server.addEventListener('message', async (event) => {
			try {
				const messageData = event.data;
				console.log(`DO Received: ${messageData}`);

				if (typeof messageData === 'string') {
					const parsedMessage = JSON.parse(messageData);

					if (parsedMessage.type === 'START_CONVERSATION') {
						if (this.isConversing) {
							this.sendSystemMessage('既に会話が進行中です。');
							return;
						}
						this.isConversing = true;
						this.currentTurn = 0;
						this.conversationHistory = [];
						this.currentAgentName = 'Bob';

						this.sendSystemMessage('ALVAとBobの会話を開始します...');

						const bobInitialQuotes = [
							"言葉とは、誤解の源泉である。（アントワーヌ・ド・サン＝テグジュペリ）",
							"まだ慌てるような時間じゃない。(仙道彰)",
							"すべての言葉は、それ自体が一個の詩である。（ラルフ・ウォルド・エマーソン）",
						];
						const randomIndex = Math.floor(Math.random() * bobInitialQuotes.length);
						const firstBobMessageText = bobInitialQuotes[randomIndex];
						
						const firstBobMessage: ChatMessage = {
							speaker: 'Bob',
							text: firstBobMessageText,
							timestamp: new Date()
						};
						this.addMessageToHistoryAndSend(firstBobMessage);
						
						try {
							await this.waitForAudioPlayback();
						} catch (error) {
							console.log("waitForAudioPlayback rejected during initial Bob message:", error);
							// stopConversation will be called if isConversing is true
							if(this.isConversing) this.stopConversation();
							return;
						}
						if (!this.isConversing) return;

						this.currentAgentName = 'ALVA';
						await this.processNextTurn();

					} else if (parsedMessage.type === 'USER_MESSAGE' && typeof parsedMessage.text === 'string') {
						console.log(`User message received, but AI is in autonomous conversation mode: ${parsedMessage.text}`);
					
					} else if (parsedMessage.type === 'AUDIO_PLAYBACK_COMPLETE') {
						console.log('Received AUDIO_PLAYBACK_COMPLETE from client.');
						if (this.audioPlaybackCompletion) {
							if(this.audioPlaybackCompletion.timeoutId) clearTimeout(this.audioPlaybackCompletion.timeoutId);
							this.audioPlaybackCompletion.resolve();
							this.audioPlaybackCompletion = undefined;
						}
					
					} else if (parsedMessage.type === 'STOP_CONVERSATION') {
						this.stopConversation();
						return;
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
			this.stopConversation();
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
			const storableHistory = this.conversationHistory.map(msg => ({
				...msg,
				timestamp: msg.timestamp.toISOString(),
			}));
			await this.storage.put("conversationHistory", storableHistory);
			console.log("Conversation history saved to storage.");
		} catch (e) {
			console.error("Error saving history to storage:", e);
		}
	}

	sendSystemMessage(text: string) {
		const message: ChatMessage = {
			speaker: 'System',
			text,
			timestamp: new Date(),
		};
		this.addMessageToHistoryAndSend(message);
	}

	addMessageToHistoryAndSend(message: ChatMessage) {
		this.addMessageToHistory(message);
		if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
			const serializableMessage = {
				...message,
				timestamp: message.timestamp.toISOString(),
			};
			this.webSocket.send(JSON.stringify(serializableMessage));
		}
	}

	async waitForAudioPlayback(): Promise<void> {
		if (!this.isConversing) {
			console.log("waitForAudioPlayback: Conversation not active, resolving immediately.");
			return Promise.resolve();
		}
		console.log("waitForAudioPlayback: Setting up wait for client audio playback...");
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				console.warn(`Audio playback complete timed out after ${AUDIO_PLAYBACK_TIMEOUT}ms`);
				if (this.audioPlaybackCompletion) {
					this.audioPlaybackCompletion.reject('Timeout');
					this.audioPlaybackCompletion = undefined;
				}
			}, AUDIO_PLAYBACK_TIMEOUT) as unknown as number;

			this.audioPlaybackCompletion = { resolve, reject, timeoutId };
		});
	}

	async processNextTurn(): Promise<void> {
		if (!this.isConversing || !this.geminiAI) {
			console.log("processNextTurn: Conversation not active or AI not initialized.");
			return;
		}

		if (this.currentTurn >= MAX_TURNS * 2) {
			this.sendSystemMessage("会話の最大ターン数に達しました。");
			this.stopConversation();
			return;
		}
		this.currentTurn++;

		const currentSystemPrompt = this.currentAgentName === 'ALVA' ? SYSTEM_PROMPT_ALVA : SYSTEM_PROMPT_BOB;
		
		let promptForLLM = currentSystemPrompt;
		if (this.conversationHistory.length > 0) {
			const lastMessage = this.conversationHistory[this.conversationHistory.length -1];
			promptForLLM += `\n\n以下は直前の発言です。これに応答してください:\n${lastMessage.speaker}: ${lastMessage.text}`;
		} else {
			promptForLLM += "\n\n会話を始めてください。";
		}

		try {
			const model = this.geminiAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
			let aiText = "";
			const MAX_RETRIES = 3;
			const RETRY_DELAY_MS = 1000;

			for (let i = 0; i < MAX_RETRIES; i++) {
				if (!this.isConversing) { // Check if conversation was stopped during retries
					console.log("processNextTurn: Conversation stopped during retry loop.");
					return;
				}
				try {
					console.log(`Generating content for ${this.currentAgentName} (Attempt ${i + 1}/${MAX_RETRIES})...`);
					const result = await model.generateContent(promptForLLM);
					const response = result.response;
					aiText = response.text();
					break; 
				} catch (error: any) {
					console.warn(`Error generating AI response for ${this.currentAgentName} (Attempt ${i + 1}/${MAX_RETRIES}):`, error.message);
					if (i === MAX_RETRIES - 1) {
						throw error; 
					}
					await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1)));
				}
			}

			const aiMessage: ChatMessage = {
				speaker: this.currentAgentName,
				text: aiText,
				timestamp: new Date()
			};
			this.addMessageToHistoryAndSend(aiMessage);

			try {
				await this.waitForAudioPlayback();
			} catch (error) {
				console.log("waitForAudioPlayback rejected during AI turn:", error);
				if(this.isConversing) this.stopConversation();
				return;
			}
			if (!this.isConversing) return;

			this.currentAgentName = this.currentAgentName === 'ALVA' ? 'Bob' : 'ALVA';
			setTimeout(() => {
				if (this.isConversing) {
					this.processNextTurn();
				}
			}, 100);

		} catch (aiError) {
			console.error(`Error generating AI response for ${this.currentAgentName} after retries:`, aiError);
			this.sendSystemMessage(`${this.currentAgentName}の応答生成に失敗しました。`);
			this.stopConversation();
			return; 
		}
	}
	
	stopConversation() {
		if (!this.isConversing && !this.audioPlaybackCompletion) {
			console.log("stopConversation: Already stopped or no active audio wait.");
			return;
		}
		
		console.log('stopConversation: Stopping conversation...');
		this.isConversing = false; 

		if (this.audioPlaybackCompletion) {
			if(this.audioPlaybackCompletion.timeoutId) clearTimeout(this.audioPlaybackCompletion.timeoutId);
			this.audioPlaybackCompletion.reject('Conversation stopped by explicit call'); 
			this.audioPlaybackCompletion = undefined;
		}
		this.sendSystemMessage('会話が停止されました。');
		console.log('Conversation definitively stopped.');
	}
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: [
    'http://localhost:5173', // Local Vite dev server
    'https://automated-chat.pages.dev',
    'https://quotecast.do-not-connect.com'
  ], 
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.onError(async (err, c) => {
  console.error('Unhandled Error:', err.message);
  if (err instanceof HTTPException) {
    if (err.status === 400) {
      try {
        const errorResponseJson = await err.getResponse().json();
        if (errorResponseJson && typeof errorResponseJson === 'object' && 'error' in errorResponseJson && errorResponseJson.error && typeof errorResponseJson.error === 'object' && 'issues' in errorResponseJson.error) {
          console.error('Validation Issues:', (errorResponseJson.error as any).issues);
        } else {
          console.error('400 Error Response Body:', errorResponseJson);
        }
      } catch (e) {
        console.error('Could not parse 400 error response body. Raw response text:', await err.getResponse().text());
      }
    }
    return err.getResponse();
  }
  return c.json({ error: 'Internal Server Error', message: err.message || 'Unknown error' }, 500);
});

app.get('/', (c) => {
	return c.text('Hello from Hono on Cloudflare Workers!');
});

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

app.get('/websocket', async (c) => {
	const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("default-conversation");
	const stub = c.env.MY_DURABLE_OBJECT.get(id);
	return stub.fetch(c.req.raw); 
});

const worker: ExportedHandler<Env> = {
	fetch: app.fetch,
};

export default worker;
