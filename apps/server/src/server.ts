import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createCharacter, applyOps, type CreationChoices, type GameState } from '@rpg/engine';
import {
	loadConfig,
	snapshotBaseline,
	applyOverrides,
	publicConfigView,
	toModelList,
	hashPassword,
	verifyPassword,
	type ConfigOverrides,
	type AuthSecret
} from './config';
import { Db } from './db';
import { Campaigns } from './campaigns';
import { Rag } from './rag';
import { runTurn, type TurnEvent } from './turn/run';
import { serveStatic } from './static';
import { importGame, type ImportDocs } from './import';
import { RulesStore, validRuleSlug } from './rules';

const cfg = loadConfig();
const baseline = snapshotBaseline(cfg); // env-база (до сохранённых переопределений)
// Конфиг-документ из БД: переопределения ключей/моделей + учётка входа.
let storedConfig: { overrides?: ConfigOverrides; auth?: AuthSecret } = {};
let overrides: ConfigOverrides = {};
const db = new Db(cfg);
const campaigns = new Campaigns(db);
const rag = new Rag(db, cfg);
const rules = new RulesStore(db);
const VERSION = '0.0.0';

// Выданные токены сессий (в памяти; при рестарте сервера нужен повторный вход).
const sessions = new Set<string>();

async function persistConfig(): Promise<void> {
	await db.setConfig(storedConfig);
}

function bearer(req: IncomingMessage): string {
	const h = req.headers['x-auth-token'];
	return (Array.isArray(h) ? h[0] : h) ?? '';
}

/** Защищаемые маршруты (всё API). Статика и /auth/* — открыты. */
function isProtectedPath(path: string): boolean {
	return /^\/(campaigns|turn|admin|logs|health|rules|ask)\b/.test(path);
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
	const origin = req.headers.origin;
	const any = cfg.corsOrigins.includes('*');
	if (origin && (any || cfg.corsOrigins.includes(origin))) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
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
	// --- Авторизация на вход (единый логин на весь сайт) ---
	if (path === '/auth/status') {
		json(res, 200, { configured: Boolean(storedConfig.auth) });
		return;
	}
	if (req.method === 'POST' && path === '/auth/setup') {
		if (storedConfig.auth) {
			json(res, 409, { error: 'учётка уже создана' });
			return;
		}
		if (!(await db.healthy())) {
			json(res, 503, { error: 'БД недоступна — учётку не сохранить' });
			return;
		}
		const b = await readJson<{ user?: string; password?: string }>(req);
		const user = (b.user ?? '').trim();
		const password = (b.password ?? '').toString();
		if (user.length < 2 || password.length < 4) {
			json(res, 400, { error: 'логин ≥2 символов, пароль ≥4 символов' });
			return;
		}
		storedConfig.auth = hashPassword(password, user);
		await persistConfig();
		const token = randomBytes(24).toString('hex');
		sessions.add(token);
		json(res, 200, { token, user });
		return;
	}
	if (req.method === 'POST' && path === '/auth/login') {
		const b = await readJson<{ user?: string; password?: string }>(req);
		if (!storedConfig.auth || !verifyPassword((b.user ?? '').toString(), (b.password ?? '').toString(), storedConfig.auth)) {
			json(res, 401, { error: 'неверный логин или пароль' });
			return;
		}
		const token = randomBytes(24).toString('hex');
		sessions.add(token);
		json(res, 200, { token, user: storedConfig.auth.user });
		return;
	}
	if (req.method === 'POST' && path === '/auth/logout') {
		sessions.delete(bearer(req));
		json(res, 200, { ok: true });
		return;
	}

	// Гейт: всё API — только с валидным токеном (учётка задаётся при первом входе).
	if (isProtectedPath(path)) {
		if (!storedConfig.auth) {
			json(res, 401, { error: 'нужна первичная настройка входа', needsSetup: true });
			return;
		}
		if (!sessions.has(bearer(req))) {
			json(res, 401, { error: 'требуется вход' });
			return;
		}
	}

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

	// GET /ask?campaign=<id>&turn=<n?> — мета-режим: курируемое окно в NDJSON-лог хода (§11, §22.7).
	if (req.method === 'GET' && path === '/ask') {
		const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
		const campaign = u.searchParams.get('campaign');
		if (!campaign) {
			json(res, 400, { error: 'нужен параметр campaign' });
			return;
		}
		let turn = Number(u.searchParams.get('turn')) || 0;
		if (!turn) {
			const t = await db.pool.query('SELECT max(turn_id) AS m FROM logs WHERE campaign_id = $1 AND turn_id > 0', [campaign]);
			turn = (t.rows[0]?.m as number) || 0;
		}
		// Курируем «под капот»: броски, валидация, дельты, модели, утечки, мир-сим (не сырые промпты).
		const KINDS = ['input', 'mechanics', 'context_assembled', 'llm_call', 'validation', 'applied_ops', 'state_diff', 'leak_fixed', 'leak_detected', 'worldsim', 'persist', 'death', 'error'];
		const r = await db.pool.query(
			`SELECT seq, type, level, payload FROM logs WHERE campaign_id = $1 AND turn_id = $2 AND type = ANY($3) ORDER BY seq`,
			[campaign, turn, KINDS]
		);
		json(res, 200, { turn, events: r.rows });
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
			await runTurn(cfg, db, campaigns, rag, rules, body.campaignId, body.input, send);
		} catch (e) {
			// error (ТЗ §22.3): фиксируем исключение хода в лог отдельно от состояния.
			try {
				await db.pool.query(
					'INSERT INTO logs (campaign_id, ts, turn_id, seq, type, level, payload) VALUES ($1, $2, 0, 0, $3, $4, $5)',
					[body.campaignId, Date.now(), 'error', 'error', JSON.stringify({ stage: 'turn', message: (e as Error).message })]
				);
			} catch {
				/* лог не критичен */
			}
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

	// --- Правила мира («Правила мира» в админке): загрузка/правка/версии/откат, горячее применение ---
	if (path === '/admin/rules' && req.method === 'GET') {
		json(res, 200, { rules: rules.list() });
		return;
	}
	const rm = path.match(/^\/admin\/rules\/([a-z][a-z0-9_-]{1,40})(\/(versions|restore))?$/);
	if (rm) {
		const slug = rm[1]!;
		const sub = rm[3];
		if (!validRuleSlug(slug)) {
			json(res, 400, { error: 'недопустимый slug правила' });
			return;
		}
		if (req.method === 'GET' && sub === 'versions') {
			json(res, 200, { versions: await rules.versions(slug) });
			return;
		}
		if (req.method === 'POST' && sub === 'restore') {
			if (!(await db.healthy())) {
				json(res, 503, { error: 'БД недоступна — откат невозможен' });
				return;
			}
			const b = await readJson<{ version?: number }>(req);
			const row = await rules.restore(slug, Number(b.version));
			if (!row) {
				json(res, 404, { error: 'версия не найдена' });
				return;
			}
			json(res, 200, { rule: row });
			return;
		}
		if ((req.method === 'PUT' || req.method === 'POST') && !sub) {
			if (!(await db.healthy())) {
				json(res, 503, { error: 'БД недоступна — сохранить правило нельзя' });
				return;
			}
			const b = await readJson<{ full_text?: string; prompt_core?: string }>(req);
			const fullText = typeof b.full_text === 'string' ? b.full_text : '';
			const promptCore = typeof b.prompt_core === 'string' ? b.prompt_core : '';
			const row = await rules.save(slug, fullText, promptCore);
			json(res, 200, { rule: row });
			return;
		}
	}

	const m = path.match(/^\/campaigns\/([\w-]+)(\/(load|save|snapshots|restore|spec))?$/);
	if (m) {
		const id = m[1]!;
		const sub = m[3];
		// Выбор специализации игроком (слой 3 прогрессии, §9.11) — прямой ход игрока, не нарратора.
		if (req.method === 'POST' && sub === 'spec') {
			const body = await readJson<{ choice?: string }>(req);
			const choice = (body.choice ?? '').trim();
			if (!choice) {
				json(res, 400, { error: 'нужен choice' });
				return;
			}
			const state = await campaigns.load(id);
			if (!state) {
				json(res, 404, { error: 'кампания не найдена' });
				return;
			}
			const result = applyOps(state, [{ op: 'specialization.select', choice }], { day: state.session.day });
			await campaigns.save(id, result.state);
			json(res, 200, { state: result.state });
			return;
		}
		if (req.method === 'POST' && sub === 'restore') {
			const body = await readJson<{ snapshotId?: number }>(req);
			if (body.snapshotId == null) {
				json(res, 400, { error: 'нужен snapshotId' });
				return;
			}
			const r = await campaigns.restore(Number(body.snapshotId));
			if (!r || r.campaignId !== id) {
				json(res, 404, { error: 'снапшот не найден для этой кампании' });
				return;
			}
			json(res, 200, { state: r.state });
			return;
		}
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
			// Поддержка нового формата { overrides, auth } и старого плоского { keys, models }.
			if (raw.overrides || raw.auth) storedConfig = { overrides: raw.overrides as ConfigOverrides, auth: raw.auth as AuthSecret };
			else if (raw.keys || raw.models) storedConfig = { overrides: raw as ConfigOverrides };
			overrides = storedConfig.overrides ?? {};
			applyOverrides(cfg, baseline, overrides);
			const ovK = Object.keys(overrides.keys ?? {}).length;
			const ovM = Object.keys(overrides.models ?? {}).length;
			if (ovK || ovM) console.log(`[server] конфиг из БД: ключей ${ovK}, моделей ${ovM}`);
		} catch (e) {
			console.error('[server] не удалось загрузить конфиг из БД:', (e as Error).message);
		}
		try {
			await rules.init();
		} catch (e) {
			console.error('[server] не удалось загрузить правила из БД:', (e as Error).message);
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

// Страховка: один плохой ход не должен ронять процесс (иначе игра «падает» на сервере).
// Логируем причину в БД (отдельно от состояния) и остаёмся живы. (ТЗ §19, §22.)
async function logCrash(kind: string, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.stack || err.message : String(err);
	console.error(`[server] ${kind}:`, message);
	try {
		await db.pool.query(
			'INSERT INTO logs (campaign_id, ts, turn_id, seq, type, level, payload) VALUES (NULL, $1, 0, 0, $2, $3, $4)',
			[Date.now(), 'error', 'error', JSON.stringify({ stage: kind, message: message.slice(0, 4000) })]
		);
	} catch {
		/* лог не критичен */
	}
}
process.on('unhandledRejection', (reason) => void logCrash('unhandledRejection', reason));
process.on('uncaughtException', (err) => void logCrash('uncaughtException', err));

void main();
