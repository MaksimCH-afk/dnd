import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
	HealthResponse,
	LlmRequest,
	LlmStreamEvent,
	VerifyKeyRequest,
	VerifyKeyResponse
} from '@rpg/engine';
import { loadConfig } from './config';
import { streamCompletion, verifyKey } from './openrouter';

const cfg = loadConfig();
const VERSION = '0.0.0';

function setCors(req: IncomingMessage, res: ServerResponse): void {
	const origin = req.headers.origin;
	// '*' в CORS_ORIGINS → отражаем любой origin (удобно для домашней сети/планшета).
	const allowAny = cfg.corsOrigins.includes('*');
	if (origin && (allowAny || cfg.corsOrigins.includes(origin))) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader(
		'Access-Control-Allow-Headers',
		'Content-Type, Authorization, Accept, User-Agent, Git-Protocol, X-Requested-With, Content-Length'
	);
	res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
	res.setHeader('Access-Control-Max-Age', '86400');
}

/** Сырое тело запроса (для git-pack — бинарные данные). */
async function readRawBody(req: IncomingMessage, limitBytes = 50_000_000): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size > limitBytes) {
				reject(new Error('git-тело слишком большое'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/**
 * Git-CORS-прокси (для isomorphic-git): /gitproxy/<host>/<path> → https://<host>/<path>.
 * Пробрасывает метод, заголовки (вкл. Authorization) и бинарное тело pack-протокола.
 * GitHub не отдаёт CORS для git — поэтому ходим через бэкенд.
 */
async function handleGitProxy(req: IncomingMessage, res: ServerResponse, rest: string): Promise<void> {
	const target = `https://${rest}`;
	const fwdHeaders: Record<string, string> = {};
	for (const h of ['accept', 'content-type', 'user-agent', 'authorization', 'git-protocol']) {
		const v = req.headers[h];
		if (typeof v === 'string') fwdHeaders[h] = v;
	}
	if (!fwdHeaders['user-agent']) fwdHeaders['user-agent'] = 'git/isomorphic-git';

	try {
		const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRawBody(req);
		const upstream = await fetch(target, {
			method: req.method,
			headers: fwdHeaders,
			...(body && body.length ? { body } : {})
		});
		const buf = Buffer.from(await upstream.arrayBuffer());
		res.statusCode = upstream.status;
		const ct = upstream.headers.get('content-type');
		if (ct) res.setHeader('Content-Type', ct);
		res.end(buf);
	} catch (err) {
		json(res, 502, { error: `git-прокси: ${(err as Error).message}` });
	}
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
	const body: HealthResponse = { ok: true, hasEnvKey: Boolean(cfg.apiKey), models, version: VERSION };
	json(res, 200, body);
}

async function handleVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
	let parsed: VerifyKeyRequest;
	try {
		parsed = JSON.parse(await readBody(req)) as VerifyKeyRequest;
	} catch (err) {
		json(res, 400, { error: `некорректное тело: ${(err as Error).message}` });
		return;
	}
	const result = await verifyKey(parsed.apiKey ?? '');
	const body: VerifyKeyResponse = result;
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

	if (req.method === 'POST' && path === '/verify') {
		void handleVerify(req, res);
		return;
	}

	if (path.startsWith('/gitproxy/')) {
		void handleGitProxy(req, res, decodeURIComponent(path.slice('/gitproxy/'.length)) + url.search);
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
	const keyState = cfg.apiKey
		? 'env-сид ключа задан'
		: 'ключ ожидается из UI (env-сид не задан — это норма)';
	console.log(`[proxy] слушаю :${cfg.port} — ${keyState}`);
	console.log(`[proxy] CORS origins: ${cfg.corsOrigins.join(', ') || '(нет)'}`);
});
