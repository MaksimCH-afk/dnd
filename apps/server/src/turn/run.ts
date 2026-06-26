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
	tickWorld,
	advanceByScale,
	actionTimeScale,
	npcRecognizesHeroSecret,
	type CombatStyle,
	type GameState,
	type Op
} from '@rpg/engine';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import type { Campaigns } from '../campaigns';
import type { RuleInjector } from '../rules';
import { streamCompletion, complete } from '../openrouter';
import type { Rag } from '../rag';
import { buildNarratorMessages } from './prompt';
import { extractOps, isDarkScene } from './ops-extract';
import { statusFields, threadModel } from './status';
import { composeHook } from './director';
import { heroSecretTokens, heroHiddenTraits, sceneHasBlindNpc, heroHasSecret, scanLeakTokens } from './leak';

export type TurnEvent =
	| { type: 'delta'; text: string }
	| { type: 'system'; text: string }
	| { type: 'done'; master: string; model?: string; usedFallback?: boolean; status: ReturnType<typeof statusFields>; thread: ReturnType<typeof threadModel>; applied: string[]; rejected: { reason: string }[]; state: GameState; dead?: boolean }
	| { type: 'error'; message: string; code?: string };

type Send = (e: TurnEvent) => void;

const DIRECTOR_INTERVAL = 6;
const WORLD_TICK_INTERVAL = 4; // как часто мир-симуляция двигает фракции (ТЗ §12)
const AUTOSNAPSHOT_EVERY = 5; // каждые N ходов — точка возврата
const AUTOSNAPSHOT_KEEP = 20; // сколько автосейвов держать (ручные /save не трогаются)

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
	rules: RuleInjector,
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
	const messages = buildNarratorMessages(state, input, retrieved, outcomes, rules);
	// context_assembled (ТЗ §22.3): RAG-запрос + top-k + карточки NPC + активные модули + оценка длины.
	const sysContent = messages[0]?.content ?? '';
	void logEvent(db, campaignId, turnId, seq++, 'context_assembled', 'info', {
		rag_query: `${input} ${state.session.current_moment}`.slice(0, 200),
		retrieved_count: retrieved.length,
		retrieved: retrieved.slice(0, 8),
		npc_cards: state.session.npcs_in_scene,
		active_modules: Object.keys(state.character.modules),
		layer_b: sysContent.includes('СПРАВКА ПО МИРУ'),
		prompt_chars: sysContent.length,
		prompt_tokens_est: Math.round(sysContent.length / 4)
	});
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
			void logEvent(db, campaignId, turnId, seq++, 'error', 'error', { stage: 'narrator', message: ev.message, code: ev.code });
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
	// Снимок ключевых сущностей ДО применения — для числового state_diff (диагностика №5).
	const snap = (s: GameState) => ({
		capital: s.inventory.capital_mp,
		hp: s.character.core.hp.cur,
		stamina: s.character.core.stamina.cur,
		items: s.inventory.items.map((i) => `${i.id}×${i.qty}`)
	});
	const beforeSnap = snap(state);
	const res = applyOps(state, ops, { day });
	state = res.state;
	const masterEntry: { speaker: 'master'; text: string; model?: string } = { speaker: 'master', text: master, ...(model ? { model } : {}) };
	state.transcript = [...(state.transcript ?? []), masterEntry];
	void logEvent(db, campaignId, turnId, seq++, 'applied_ops', 'info', { applied: res.applied.map((o) => o.op), rejected: res.rejected });
	// state_diff (ТЗ §22.3): числовой дифф before→after по капиталу/HP/выносл./инвентарю — ловит №5.
	const afterSnap = snap(state);
	void logEvent(db, campaignId, turnId, seq++, 'state_diff', 'info', {
		...(beforeSnap.capital !== afterSnap.capital ? { capital: [beforeSnap.capital, afterSnap.capital] } : {}),
		...(beforeSnap.hp !== afterSnap.hp ? { hp: [beforeSnap.hp, afterSnap.hp] } : {}),
		...(beforeSnap.stamina !== afterSnap.stamina ? { stamina: [beforeSnap.stamina, afterSnap.stamina] } : {}),
		items_added: afterSnap.items.filter((x) => !beforeSnap.items.includes(x)),
		items_removed: beforeSnap.items.filter((x) => !afterSnap.items.includes(x))
	});
	// validation (ТЗ §22.3): что предложено/применено/отклонено и почему (детерминированные проверки движка).
	void logEvent(db, campaignId, turnId, seq++, 'validation', 'info', {
		proposed: ops.length,
		applied: res.applied.length,
		rejected: res.rejected.map((r) => ({ op: r.op.op, reason: r.reason }))
	});
	if (res.rejected.length) {
		const text = `Движок отклонил ${res.rejected.length} оп.: ${res.rejected.map((r) => r.reason).join('; ')}`;
		state.transcript.push({ speaker: 'system', text });
		send({ type: 'system', text });
	}

	// 3a) Защита от утечки тайн героя в прозе NPC (баг №3): скан токенов + условный валидатор.
	const st = state; // не-null ссылка для замыканий ниже
	const secretTokens = heroSecretTokens(st);
	let leakReason = '';
	const tokenLeak = scanLeakTokens(master, secretTokens);
	if (tokenLeak.length) leakReason = `токены: ${tokenLeak.join(', ')}`;
	// Уровень 2 — только риск-ход (в сцене есть NPC, не знающий тайн, и тайны есть) и дешёвой моделью.
	if (!leakReason && sceneHasBlindNpc(st) && heroHasSecret(st)) {
		const blind = st.session.npcs_in_scene
			.filter((id) => !npcRecognizesHeroSecret(st, id))
			.map((id) => st.npc.find((n) => n.id === id)?.core.name)
			.filter(Boolean);
		const mustNot = [...secretTokens, ...heroHiddenTraits(st)];
		const vsys = 'Ты — проверяющий утечки. Верни СТРОГИЙ JSON {"leak":true|false,"detail":"кратко"}. Только JSON.';
		const vusr = `NPC, не знающие тайн героя: ${blind.join(', ') || '—'}.\nЭти тайны они НЕ должны раскрывать или намекать на них: ${mustNot.join('; ')}.\nТекст сцены:\n${master}\n\nЕсть ли в словах/намёках этих NPC утечка любой тайны (дословно или пересказом)?`;
		try {
			const vraw = await complete(cfg, 'validator', [{ role: 'system', content: vsys }, { role: 'user', content: vusr }], { temperature: 0, maxTokens: 200 });
			const a = vraw.indexOf('{');
			const b = vraw.lastIndexOf('}');
			if (a >= 0 && b > a) {
				const v = JSON.parse(vraw.slice(a, b + 1)) as { leak?: boolean; detail?: string };
				if (v.leak) leakReason = `валидатор: ${String(v.detail ?? 'утечка тайны').slice(0, 160)}`;
			}
			void logEvent(db, campaignId, turnId, seq++, 'llm_call', 'info', { role: 'validator', leak: Boolean(leakReason) });
		} catch {
			/* валидатор не критичен */
		}
	}
	if (leakReason) {
		try {
			const fixMsgs = buildNarratorMessages(state, input, retrieved, outcomes, rules);
			fixMsgs.push({
				role: 'system',
				content: `КРИТИЧНО (защита тайн героя, баг №3): перепиши сцену так, чтобы NPC, не знающие героя, НЕ раскрывали и НЕ намекали на: ${[...secretTokens, ...heroHiddenTraits(state)].join('; ')}. Сохрани события, тон и факты. Верни ТОЛЬКО прозу, без блока ops.`
			});
			const fixed = await complete(cfg, 'narrator', fixMsgs, { preferFallback });
			const cleanFixed = extractOps(fixed).clean || fixed;
			if (cleanFixed.trim()) {
				master = cleanFixed.trim();
				masterEntry.text = master;
			}
			const note = '⚠ Мастер переписал сцену: NPC не должен был раскрыть тайну героя.';
			state.transcript!.push({ speaker: 'system', text: note });
			send({ type: 'system', text: note });
			void logEvent(db, campaignId, turnId, seq++, 'leak_fixed', 'warn', { reason: leakReason });
		} catch {
			void logEvent(db, campaignId, turnId, seq++, 'leak_detected', 'warn', { reason: leakReason, fixed: false });
		}
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

	// 3d) Продвижение времени по весу действия (ТЗ §9.6) — несущая балка: без хода времени
	// дедлайны/таймеры/time-seeds/заживление мертвы. Нарратор может прислать time.advance
	// (дорога/ожидание/сон); иначе — детерминированный фоллбэк по тексту действия. В бою время
	// идёт секундами (отдельно), слоты не двигаем.
	if (!state.combat && !ops.some((o) => o.op === 'time.advance')) {
		state.session = advanceByScale(state.session, actionTimeScale(input));
	}
	const newDay = state.session.day;
	const dayDelta = newDay - day;
	if (dayDelta > 0) {
		// Наступившие дедлайны/таймеры (due_day достигнут).
		const fired = state.timers.filter((t) => t.due_day <= newDay);
		if (fired.length) {
			state.timers = state.timers.filter((t) => t.due_day > newDay);
			for (const t of fired) {
				const text = `⏳ Срок наступил: ${t.label}`;
				state.transcript!.push({ speaker: 'system', text });
				send({ type: 'system', text });
			}
		}
		// Заживление/восстановление по прошедшему времени (пассивно, sleep-rate; §9.6).
		const cc = state.character.core;
		const hpHealed = Math.min(cc.hp.max - cc.hp.cur, 10 * dayDelta);
		if (hpHealed > 0) cc.hp.cur += hpHealed;
		cc.stamina.cur = cc.stamina.max;
		if (state.character.modules.magic) state.character.modules.magic.power = 'Полон';
		const text = `🕓 Проходит время — наступает День ${newDay}, ${state.session.time_of_day}.`;
		state.transcript!.push({ speaker: 'system', text });
		send({ type: 'system', text });
		void logEvent(db, campaignId, turnId, seq++, 'mechanics', 'info', { kind: 'time', dayDelta, newDay, time_of_day: state.session.time_of_day, firedTimers: fired.map((t) => t.label), hpHealed });
	}

	// 3c) Мир-симуляция (ТЗ §12, чинит №1): фракции двигаются сами, рождают слухи/seeds.
	// Тик по интервалу и вне боя — новизна из симуляции, не из выдумки модели.
	if (!state.combat && turnId % WORLD_TICK_INTERVAL === 0) {
		const wRng = makeRng(seedFromString(`world|${newDay}|${turnId}`));
		const wr = tickWorld(state, wRng);
		state = wr.state;
		for (const r of wr.rumors) {
			const text = `⟳ Мир живёт: ${r}`;
			state.transcript!.push({ speaker: 'system', text });
			send({ type: 'system', text });
		}
		void logEvent(db, campaignId, turnId, seq++, 'worldsim', 'info', { kind: 'tick', clock_day: state.world_state?.clock_day, rumors: wr.rumors.length });
	}

	// 4) Отложенные последствия (seeds) — против текущего (продвинутого) дня.
	const seedRng = makeRng(seedFromString(`seeds|${newDay}|${state.seeds.length}`));
	const seedRes = tickSeeds(state, newDay, seedRng);
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
		const hook = await composeHook(cfg, arc, state, rules);
		const text = `🎬 Новый поворот на горизонте: ${hook}`;
		state.transcript!.push({ speaker: 'system', text });
		send({ type: 'system', text });
	}

	// 5b) Смерть героя (ТЗ §14): 0 HP → финал, без воскрешения по прихоти. Предложить откат/новую игру.
	const dead = state.character.core.hp.cur <= 0;
	if (dead) {
		const note = '☠ Герой пал. Смерть значима и окончательна — движок не воскрешает. Восстанови раннюю точку сохранения (честный «загруз») или начни новую игру.';
		state.transcript!.push({ speaker: 'system', text: note });
		send({ type: 'system', text: note });
		void logEvent(db, campaignId, turnId, seq++, 'death', 'warn', { day, hp: state.character.core.hp });
	}

	// 6) Персист в Postgres + автоснапшот (точка возврата, ТЗ §15) + финальное событие.
	await campaigns.save(campaignId, state);
	let snapshotId: number | undefined;
	if (dead || turnId % AUTOSNAPSHOT_EVERY === 0) {
		try {
			snapshotId = await campaigns.snapshot(campaignId, dead ? `гибель · День ${day}` : `автосейв · День ${day}`, state);
			await campaigns.pruneAutosaves(campaignId, AUTOSNAPSHOT_KEEP);
		} catch {
			/* снапшот не критичен для хода */
		}
	}
	void logEvent(db, campaignId, turnId, seq++, 'persist', 'info', { schema_version: state.schema_version, day, ...(snapshotId ? { snapshotId } : {}), dead });
	send({
		type: 'done',
		master,
		...(model ? { model } : {}),
		usedFallback,
		status: statusFields(state),
		thread: threadModel(state),
		applied: res.applied.map((o) => o.op),
		rejected: res.rejected.map((r) => ({ reason: r.reason })),
		state,
		...(dead ? { dead: true } : {})
	});

	// 7) Индексация новых фактов/NPC в pgvector (после ответа — не задерживает прозу).
	for (const f of state.facts.slice(factsBefore)) {
		await rag.index(campaignId, 'fact', f.id, f.text, f.created_day);
	}
	for (const n of state.npc.slice(npcBefore)) {
		await rag.index(campaignId, 'npc', n.id, `${n.core.name}: ${n.core.role}, ${n.core.character}`, day);
	}
}
