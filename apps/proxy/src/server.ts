import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HealthResponse, LlmRequest, LlmStreamEvent } from '@rpg/engine';
import { loadConfig } from './config';
import { streamCompletion } from './openrouter';

const cfg = loadConfig();
const VERSION = '0.0.0';

function setCors(req: IncomingMessage, res: ServerResponse): void {
	const origin = req.headers.origin;
	if (origin && cfg.corsOrigins.includes(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(payload);
}

async function readBody(req: IncomingMessage, limitBytes = 2_000_000): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size > limitBytes) {
				reject(new Error('тело запроса слишком большое'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

function sseWrite(res: ServerResponse, event: LlmStreamEvent): void {
	res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function handleHealth(res: ServerResponse): void {
	const models: HealthResponse['models'] = {};
	for (const [role, m] of Object.entries(cfg.models.models)) {
		models[role] = { model: m.model, ...(m.alternative ? { alternative: m.alternative } : {}) };
	}
	const body: HealthResponse = { ok: true, hasApiKey: Boolean(cfg.apiKey), models, version: VERSION };
	json(res, 200, body);
}

async function handleLlm(
	req: IncomingMessage,
	res: ServerResponse,
	role: string
): Promise<void> {
	let parsed: LlmRequest;
	try {
		const raw = await readBody(req);
		parsed = JSON.parse(raw) as LlmRequest;
		if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
			json(res, 400, { error: 'messages обязательны' });
			return;
		}
	} catch (err) {
		json(res, 400, { error: `некорректное тело: ${(err as Error).message}` });
		return;
	}

	// SSE-заголовки
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no'
	});

	const ac = new AbortController();
	req.on('close', () => ac.abort());

	try {
		for await (const event of streamCompletion(cfg, role, parsed, ac.signal)) {
			sseWrite(res, event);
		}
	} catch (err) {
		if (!ac.signal.aborted) {
			sseWrite(res, { type: 'error', message: (err as Error).message, code: 'internal' });
		}
	} finally {
		res.end();
	}
}

const server = createServer((req, res) => {
	setCors(req, res);

	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	const path = url.pathname;

	if (req.method === 'GET' && path === '/health') {
		handleHealth(res);
		return;
	}

	const llmMatch = path.match(/^\/llm\/([a-z_]+)$/);
	if (req.method === 'POST' && llmMatch) {
		void handleLlm(req, res, llmMatch[1]!);
		return;
	}

	if (req.method === 'POST' && path === '/embed') {
		// По умолчанию эмбеддер локальный (transformers.js в PWA). Сервер-вариант — фаза 3.
		json(res, 501, { error: 'эмбеддинги по умолчанию локальные в PWA; серверный /embed не включён' });
		return;
	}

	json(res, 404, { error: 'не найдено' });
});

server.listen(cfg.port, () => {
	const keyState = cfg.apiKey ? 'ключ задан' : 'ВНИМАНИЕ: OPENROUTER_API_KEY не задан';
	console.log(`[proxy] слушаю :${cfg.port} — ${keyState}`);
	console.log(`[proxy] CORS origins: ${cfg.corsOrigins.join(', ') || '(нет)'}`);
});
