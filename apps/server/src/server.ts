import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createCharacter, type CreationChoices, type GameState } from '@rpg/engine';
import {
	loadConfig,
	snapshotBaseline,
	applyOverrides,
	publicConfigView,
	toModelList,
	type ConfigOverrides
} from './config';
import { Db } from './db';
import { Campaigns } from './campaigns';
import { Rag } from './rag';
import { runTurn, type TurnEvent } from './turn/run';
import { serveStatic } from './static';
import { importGame, type ImportDocs } from './import';

const cfg = loadConfig();
const baseline = snapshotBaseline(cfg); // env-база (до сохранённых переопределений)
// Конфиг-документ из БД: переопределения ключей/моделей (без пароля — гейта нет).
let storedConfig: { overrides?: ConfigOverrides } = {};
let overrides: ConfigOverrides = {};
const db = new Db(cfg);
const campaigns = new Campaigns(db);
const rag = new Rag(db, cfg);
const VERSION = '0.0.0';

async function persistConfig(): Promise<void> {
	await db.setConfig(storedConfig);
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
	const origin = req.headers.origin;
	const any = cfg.corsOrigins.includes('*');
	if (origin && (any || cfg.corsOrigins.includes(origin))) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
		const models: Record<string, { model: string; alternatives?: string[] }> = {};
		for (const [role, m] of Object.entries(cfg.models.models)) {
			models[role] = { model: m.model, ...(m.alternatives?.length ? { alternatives: m.alternatives } : {}) };
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

	// GET /logs/export — выгрузка всех служебных логов + снимок состояния сервера (файл)
	if (req.method === 'GET' && path === '/logs/export') {
		const models: Record<string, string> = {};
		for (const [role, m] of Object.entries(cfg.models.models)) models[role] = m.model;
		let logs: unknown[] = [];
		let logsError: string | undefined;
		try {
			logs = await db.exportLogs(50000);
		} catch (e) {
			logsError = (e as Error).message;
		}
		const meta = {
			exportedAt: new Date().toISOString(),
			version: VERSION,
			db: await db.healthy(),
			hasKey: Boolean(cfg.keys.default || cfg.keys.narrator),
			models,
			overrides: { keys: overrides.keys ? Object.keys(overrides.keys) : [], models: overrides.models ?? {} }
		};
		const body = JSON.stringify(
			{ meta, count: logs.length, truncated: logs.length >= 50000, ...(logsError ? { logsError } : {}), logs },
			null,
			2
		);
		res.writeHead(200, {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': 'attachment; filename="rpg-server-logs.json"'
		});
		res.end(body);
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

	// POST /campaigns/import  { docs } — собрать партию из 4 документов (LLM → движок)
	if (req.method === 'POST' && path === '/campaigns/import') {
		const body = await readJson<{ docs?: ImportDocs }>(req);
		const d = body.docs;
		if (!d || !(d.character || d.inventory || d.npcs || d.session)) {
			json(res, 400, { error: 'нужны docs (хотя бы один непустой документ)' });
			return;
		}
		try {
			const { state, name, warnings } = await importGame(cfg, d);
			const id = await campaigns.create(name, state);
			json(res, 200, { id, state, warnings });
		} catch (e) {
			json(res, 502, { error: `импорт не удался: ${(e as Error).message}` });
		}
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

	// --- Админ-конфиг (ключи/модели по ролям) — без пароля (приватный доступ) ---
	if (path === '/admin/config') {
		if (req.method === 'GET') {
			json(res, 200, publicConfigView(cfg, overrides));
			return;
		}
		if (req.method === 'PUT' || req.method === 'POST') {
			if (!(await db.healthy())) {
				json(res, 503, { error: 'БД недоступна — сохранить настройки нельзя' });
				return;
			}
			const body = await readJson<ConfigOverrides>(req);
			// merge по полям: задано — заменить, пусто ("" / []) — очистить (вернуть к дефолту), отсутствует — не трогать
			const next: ConfigOverrides = {
				keys: { ...(overrides.keys ?? {}) },
				models: { ...(overrides.models ?? {}) }
			};
			for (const [k, v] of Object.entries(body.keys ?? {})) {
				if (typeof v !== 'string') continue;
				if (v.trim()) (next.keys as Record<string, string>)[k] = v.trim();
				else delete (next.keys as Record<string, string>)[k];
			}
			for (const [k, v] of Object.entries(body.models ?? {})) {
				const listV = toModelList(v); // принимает строку или массив
				if (listV.length) (next.models as Record<string, string[]>)[k] = listV;
				else delete (next.models as Record<string, string[]>)[k];
			}
			overrides = next;
			storedConfig.overrides = overrides;
			await persistConfig();
			applyOverrides(cfg, baseline, overrides);
			json(res, 200, publicConfigView(cfg, overrides));
			return;
		}
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
		try {
			const raw = await db.getConfig();
			// Поддержка нового формата { overrides } и старого плоского { keys, models }.
			if (raw.overrides) storedConfig = { overrides: raw.overrides as ConfigOverrides };
			else if (raw.keys || raw.models) storedConfig = { overrides: raw as ConfigOverrides };
			overrides = storedConfig.overrides ?? {};
			applyOverrides(cfg, baseline, overrides);
			const ovK = Object.keys(overrides.keys ?? {}).length;
			const ovM = Object.keys(overrides.models ?? {}).length;
			if (ovK || ovM) console.log(`[server] конфиг из БД: ключей ${ovK}, моделей ${ovM}`);
		} catch (e) {
			console.error('[server] не удалось загрузить конфиг из БД:', (e as Error).message);
		}
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
