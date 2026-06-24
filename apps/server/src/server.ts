import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createCharacter, type CreationChoices, type GameState } from '@rpg/engine';
import { loadConfig } from './config';
import { Db } from './db';
import { Campaigns } from './campaigns';
import { Rag } from './rag';
import { runTurn, type TurnEvent } from './turn/run';
import { serveStatic } from './static';

const cfg = loadConfig();
const db = new Db(cfg);
const campaigns = new Campaigns(db);
const rag = new Rag(db, cfg);
const VERSION = '0.0.0';

function setCors(req: IncomingMessage, res: ServerResponse): void {
	const origin = req.headers.origin;
	const any = cfg.corsOrigins.includes('*');
	if (origin && (any || cfg.corsOrigins.includes(origin))) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
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

	void route(req, res, path).catch((e) => {
		json(res, 500, { error: (e as Error).message });
	});
});

async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
	// GET /health
	if (req.method === 'GET' && path === '/health') {
		const models: Record<string, { model: string; alternative?: string }> = {};
		for (const [role, m] of Object.entries(cfg.models.models)) {
			models[role] = { model: m.model, ...(m.alternative ? { alternative: m.alternative } : {}) };
		}
		json(res, 200, {
			ok: true,
			db: await db.healthy(),
			hasKey: Boolean(cfg.keys.default || cfg.keys.narrator),
			models,
			version: VERSION
		});
		return;
	}

	// GET /campaigns
	if (req.method === 'GET' && path === '/campaigns') {
		json(res, 200, { campaigns: await campaigns.list() });
		return;
	}

	// POST /campaigns  { name, state }
	if (req.method === 'POST' && path === '/campaigns') {
		const body = await readJson<{ name?: string; state?: GameState }>(req);
		if (!body.name || !body.state) {
			json(res, 400, { error: 'нужны name и state' });
			return;
		}
		const id = await campaigns.create(body.name, body.state);
		json(res, 200, { id });
		return;
	}

	// POST /campaigns/new  { choices }  — создание персонажа на сервере (тонкий клиент)
	if (req.method === 'POST' && path === '/campaigns/new') {
		const body = await readJson<{ choices?: CreationChoices }>(req);
		if (!body.choices?.name) {
			json(res, 400, { error: 'нужны choices с именем' });
			return;
		}
		const state = createCharacter(body.choices);
		const id = await campaigns.create(body.choices.name, state);
		json(res, 200, { id, state });
		return;
	}

	// POST /turn  { campaignId, input }  — ход (SSE-стрим)
	if (req.method === 'POST' && path === '/turn') {
		const body = await readJson<{ campaignId?: string; input?: string }>(req);
		if (!body.campaignId || !body.input) {
			json(res, 400, { error: 'нужны campaignId и input' });
			return;
		}
		res.writeHead(200, {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		});
		const send = (e: TurnEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
		try {
			await runTurn(cfg, db, campaigns, rag, body.campaignId, body.input, send);
		} catch (e) {
			send({ type: 'error', message: (e as Error).message, code: 'internal' });
		} finally {
			res.end();
		}
		return;
	}

	const m = path.match(/^\/campaigns\/([\w-]+)(\/(load|save|snapshots))?$/);
	if (m) {
		const id = m[1]!;
		const sub = m[3];
		if (req.method === 'POST' && sub === 'load') {
			const state = await campaigns.load(id);
			if (!state) {
				json(res, 404, { error: 'кампания не найдена' });
				return;
			}
			json(res, 200, { state });
			return;
		}
		if (req.method === 'POST' && sub === 'save') {
			const body = await readJson<{ state?: GameState; snapshot?: string }>(req);
			if (!body.state) {
				json(res, 400, { error: 'нужен state' });
				return;
			}
			await campaigns.save(id, body.state);
			let snapshotId: number | undefined;
			if (body.snapshot) snapshotId = await campaigns.snapshot(id, body.snapshot, body.state);
			json(res, 200, { ok: true, ...(snapshotId ? { snapshotId } : {}) });
			return;
		}
		if (req.method === 'GET' && sub === 'snapshots') {
			json(res, 200, { snapshots: await campaigns.snapshots(id) });
			return;
		}
		if (req.method === 'DELETE' && !sub) {
			await campaigns.remove(id);
			json(res, 200, { ok: true });
			return;
		}
	}

	// Не API-маршрут: пробуем отдать тонкий клиент (если собран и подключён).
	if (cfg.webDir && serveStatic(req, res, cfg.webDir, path)) return;

	json(res, 404, { error: 'не найдено' });
}

async function main(): Promise<void> {
	try {
		await db.migrate();
		console.log('[server] миграции БД применены');
	} catch (e) {
		console.error('[server] ВНИМАНИЕ: БД недоступна, миграции не применены:', (e as Error).message);
	}
	server.listen(cfg.port, () => {
		const key = cfg.keys.default || cfg.keys.narrator ? 'ключ задан' : 'ВНИМАНИЕ: ключ OpenRouter не задан';
		console.log(`[server] слушаю :${cfg.port} — ${key}`);
		console.log(`[server] CORS: ${cfg.corsOrigins.join(', ')}`);
		console.log(cfg.webDir ? `[server] раздаю тонкий клиент из ${cfg.webDir}` : '[server] статика клиента не подключена (WEB_DIR пуст)');
	});
}

void main();
