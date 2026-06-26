/**
 * Оркестратор хода на сервере (ТЗ §8, hosted). Браузер шлёт ввод — сервер гоняет
 * весь пайплайн (бой → проза нарратора → дельты движка → seeds → Режиссёр) и
 * стримит события клиенту по SSE. Источник истины — Postgres.
 */
import {
	applyOps,
	makeRng,
	seedFromString,
	tickSeeds,
	resolveExchange,
	pickNextArc,
	beginArc,
	type CombatStyle,
	type GameState,
	type Op
} from '@rpg/engine';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import type { Campaigns } from '../campaigns';
import { streamCompletion, complete } from '../openrouter';
import type { Rag } from '../rag';
import { buildNarratorMessages } from './prompt';
import { extractOps, isDarkScene } from './ops-extract';
import { statusFields, threadModel } from './status';
import { composeHook } from './director';

export type TurnEvent =
	| { type: 'delta'; text: string }
	| { type: 'system'; text: string }
	| { type: 'done'; master: string; model?: string; usedFallback?: boolean; status: ReturnType<typeof statusFields>; thread: ReturnType<typeof threadModel>; applied: string[]; rejected: { reason: string }[]; state: GameState }
	| { type: 'error'; message: string; code?: string };

type Send = (e: TurnEvent) => void;

const DIRECTOR_INTERVAL = 6;

function parseStyle(text: string): { style: CombatStyle; flee: boolean } {
	const t = text.toLowerCase();
	const flee = /бег|сбеж|отступ|удира|уход/.test(t);
	let style: CombatStyle = 'обычный';
	if (/агресс|натиск|дав/.test(t)) style = 'агрессивный';
	else if (/безрассуд|ва-?банк|отчаян/.test(t)) style = 'безрассудный';
	else if (/оборон|защищ|осторож|парир/.test(t)) style = 'оборонительный';
	else if (/только защит|глух/.test(t)) style = 'только защита';
	return { style, flee };
}

async function logEvent(db: Db, campaignId: string, turnId: number, seq: number, type: string, level: string, payload: unknown): Promise<void> {
	try {
		await db.pool.query(
			'INSERT INTO logs (campaign_id, ts, turn_id, seq, type, level, payload) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			[campaignId, Date.now(), turnId, seq, type, level, JSON.stringify(payload)]
		);
	} catch {
		/* лог не критичен */
	}
}

export async function runTurn(
	cfg: ServerConfig,
	db: Db,
	campaigns: Campaigns,
	rag: Rag,
	campaignId: string,
	input: string,
	send: Send
): Promise<void> {
	let state = await campaigns.load(campaignId);
	if (!state) {
		send({ type: 'error', message: 'кампания не найдена', code: 'no_campaign' });
		return;
	}
	const turnId = (state.transcript ?? []).filter((t) => t.speaker === 'player').length + 1;
	let seq = 0;
	const day = state.session.day;
	void logEvent(db, campaignId, turnId, seq++, 'input', 'info', { input, day });

	state.transcript = [...(state.transcript ?? []), { speaker: 'player', text: input }];

	// 1) Боевой обмен (если идёт бой) — исходы нарратору (R2).
	const outcomes: string[] = [];
	if (state.combat) {
		const { style, flee } = parseStyle(input);
		const rng = makeRng(seedFromString(`combat|${day}|${state.combat.round}|${input.length}`));
		const r = resolveExchange(state, state.combat, { style, flee }, rng);
		const ops: Op[] = [{ op: 'progress.tick', activity: 'combat' }];
		if (r.heroHpDelta) ops.push({ op: 'hp.change', delta: r.heroHpDelta, reason: 'бой' });
		if (r.staminaDelta) ops.push({ op: 'stamina.change', delta: r.staminaDelta, reason: 'бой' });
		state = applyOps(state, ops, { day }).state;
		state.combat = r.ended ? (undefined as never) : r.encounter;
		outcomes.push(...r.cues);
		if (r.heroDown) outcomes.push('Герой падает без сил — край гибели.');
		else if (r.victory) outcomes.push('Враги повержены или бежали — бой окончен.');
		void logEvent(db, campaignId, turnId, seq++, 'mechanics', 'info', { kind: 'combat', ended: r.ended, heroHpDelta: r.heroHpDelta });
	}

	// 2) Проза нарратора (стрим). RAG-ретривал из pgvector (№2). Тёмная сцена → фоллбэк.
	const retrieved = await rag.retrieve(campaignId, `${input} ${state.session.current_moment}`);
	const factsBefore = state.facts.length;
	const npcBefore = state.npc.length;
	const preferFallback = isDarkScene(input, state.session.current_moment);
	const messages = buildNarratorMessages(state, input, retrieved, outcomes);
	let prose = '';
	let model: string | undefined;
	let usedFallback = false;
	for await (const ev of streamCompletion(cfg, 'narrator', messages, { preferFallback })) {
		if (ev.type === 'delta') {
			prose += ev.text;
			send({ type: 'delta', text: ev.text });
		} else if (ev.type === 'done') {
			model = ev.meta.model;
			usedFallback = ev.meta.usedFallback;
		} else if (ev.type === 'error') {
			send({ type: 'error', message: ev.message, code: ev.code });
		}
	}
	void logEvent(db, campaignId, turnId, seq++, 'llm_call', 'info', { role: 'narrator', model, usedFallback });

	// 3) Дельты: извлечь ops и применить движком.
	const { clean, ops } = extractOps(prose);
	let master = clean;
	if (!master.trim()) {
		master = ops.length
			? '(Мастер внёс изменения, но не описал сцену. Продолжи — опиши, что делаешь.)'
			: '⚠ Мастер не прислал ответ — на бесплатной модели так бывает. Попробуй ещё раз; при повторе смени модель Ведущего в конфиге сервера.';
	}
	const res = applyOps(state, ops, { day });
	state = res.state;
	state.transcript = [...(state.transcript ?? []), { speaker: 'master', text: master, ...(model ? { model } : {}) }];
	void logEvent(db, campaignId, turnId, seq++, 'applied_ops', 'info', { applied: res.applied.map((o) => o.op), rejected: res.rejected });
	if (res.rejected.length) {
		const text = `Движок отклонил ${res.rejected.length} оп.: ${res.rejected.map((r) => r.reason).join('; ')}`;
		state.transcript.push({ speaker: 'system', text });
		send({ type: 'system', text });
	}

	// 3b) NPC-спавн-хелпер: дорисовать карточки новых NPC, если нарратор ввёл их «тонко».
	const newNpcs = state.npc
		.slice(npcBefore)
		.filter((n) => !n.core.motivation || n.core.motivation === '—' || !n.core.secret || n.core.secret === '—' || !n.core.appearance);
	for (const n of newNpcs.slice(0, 3)) {
		try {
			const sys =
				'Ты — генератор второстепенных персонажей для тёмного фэнтези. По краткому описанию верни СТРОГИЙ JSON ' +
				'{"estate","role","speech_register","character","motivation","secret","appearance"} — коротко, на русском, в духе сцены. Только JSON, без пояснений.';
			const usr = `NPC: ${n.core.name} (${n.core.race}${n.core.role && n.core.role !== 'прохожий' ? ', ' + n.core.role : ''}).\nСцена: ${state.session.current_moment}`;
			const raw = await complete(cfg, 'npc_spawn', [
				{ role: 'system', content: sys },
				{ role: 'user', content: usr }
			], { temperature: 0.8, maxTokens: 600 });
			const a = raw.indexOf('{');
			const b = raw.lastIndexOf('}');
			if (a < 0 || b <= a) continue;
			const data = JSON.parse(raw.slice(a, b + 1)) as Record<string, unknown>;
			const fields: Record<string, string> = {};
			for (const k of ['estate', 'role', 'speech_register', 'character', 'motivation', 'secret', 'appearance']) {
				const v = data[k];
				if (typeof v === 'string' && v.trim()) fields[k] = v.trim().slice(0, 220);
			}
			if (Object.keys(fields).length) {
				state = applyOps(state, [{ op: 'npc.alter_core', id: n.id, fields, cause: 'npc-спавн-хелпер' }], { day }).state;
				void logEvent(db, campaignId, turnId, seq++, 'llm_call', 'info', { role: 'npc_spawn', npc: n.id, fields: Object.keys(fields) });
			}
		} catch {
			/* хелпер не критичен — NPC останется с базовой карточкой */
		}
	}

	// 4) Отложенные последствия (seeds).
	const seedRng = makeRng(seedFromString(`seeds|${day}|${state.seeds.length}`));
	const seedRes = tickSeeds(state, day, seedRng);
	if (seedRes.fired.length) {
		state = seedRes.state;
		for (const f of seedRes.fired) {
			const text = `⟳ Мир помнит: ${f.description}`;
			state.transcript!.push({ speaker: 'system', text });
			send({ type: 'system', text });
		}
		void logEvent(db, campaignId, turnId, seq++, 'worldsim', 'info', { fired: seedRes.fired.map((f) => f.description) });
	}

	// 5) Режиссёр сам между арками (по накоплению ходов, вне боя).
	state.turns_since_arc = (state.turns_since_arc ?? 0) + 1;
	if (!state.combat && state.turns_since_arc >= DIRECTOR_INTERVAL) {
		state.turns_since_arc = 0;
		const arcRng = makeRng(seedFromString(`arc|${state.arcs.length}|${day}`));
		const arc = pickNextArc(state.arcs, arcRng);
		beginArc(state, arc);
		const hook = await composeHook(cfg, arc, state);
		const text = `🎬 Новый поворот на горизонте: ${hook}`;
		state.transcript!.push({ speaker: 'system', text });
		send({ type: 'system', text });
	}

	// 6) Персист в Postgres + финальное событие.
	await campaigns.save(campaignId, state);
	send({
		type: 'done',
		master,
		...(model ? { model } : {}),
		usedFallback,
		status: statusFields(state),
		thread: threadModel(state),
		applied: res.applied.map((o) => o.op),
		rejected: res.rejected.map((r) => ({ reason: r.reason })),
		state
	});

	// 7) Индексация новых фактов/NPC в pgvector (после ответа — не задерживает прозу).
	for (const f of state.facts.slice(factsBefore)) {
		await rag.index(campaignId, 'fact', f.id, f.text, f.created_day);
	}
	for (const n of state.npc.slice(npcBefore)) {
		await rag.index(campaignId, 'npc', n.id, `${n.core.name}: ${n.core.role}, ${n.core.character}`, day);
	}
}
