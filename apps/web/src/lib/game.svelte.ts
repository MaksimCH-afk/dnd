/**
 * Фронтовый стор игрового состояния (канон в памяти + кэш в IndexedDB).
 * Источник истины и вся механика — в @rpg/engine; здесь — реактивная обёртка
 * и персист между сессиями. Полноценная синхронизация в git — позже (ТЗ §15).
 *
 * Создание персонажа (флоу creation.md) — Фаза 2. Пока есть временный стартовый
 * персонаж (newGame), чтобы гроссбух/статус/дельты работали уже сейчас.
 */

import { browser } from '$app/environment';
import {
	applyOps as engineApply,
	makeRng,
	seedFromString,
	tickSeeds,
	tickWorld,
	pickNextArc,
	beginArc,
	migrate,
	resolveExchange,
	SCHEMA_VERSION,
	type CombatStyle,
	type GameState,
	type Op,
	type ApplyResult,
	type ProposedArc
} from '@rpg/engine';
import { IdbStore } from './idb';
import { logEvent } from './logbus.svelte';

const store = browser ? new IdbStore<GameState>('rpg-game', 'state') : null;

// Мульти-кампании (ТЗ §15): реестр + слот состояния на кампанию.
export interface CampaignMeta {
	id: string;
	name: string;
}
interface MetaDoc {
	campaigns: CampaignMeta[];
	activeId: string | null;
}
const metaStore = browser ? new IdbStore<MetaDoc>('rpg-meta', 'meta') : null;
const META_KEY = 'meta';
const stateKey = (id: string) => `c:${id}`;

export const campaigns = $state<MetaDoc>({ campaigns: [], activeId: null });

export const game = $state<{ state: GameState | null; lastApply: ApplyResult | null }>({
	state: null,
	lastApply: null
});

async function saveMeta(): Promise<void> {
	if (metaStore) await metaStore.set(META_KEY, $state.snapshot(campaigns));
}

function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 24) || 'camp'
	);
}

export async function loadGame(): Promise<void> {
	if (!store || !metaStore) return;
	const m = await metaStore.get(META_KEY);
	if (m) {
		campaigns.campaigns = m.campaigns;
		campaigns.activeId = m.activeId;
	}
	if (campaigns.activeId) {
		const saved = await store.get(stateKey(campaigns.activeId));
		if (saved) game.state = migrate(saved).state; // миграция старых сейвов (ТЗ §15)
	}
}

/** Список кампаний (для UI). */
export function listCampaigns(): CampaignMeta[] {
	return campaigns.campaigns;
}

/** Создать кампанию из готового состояния, сделать активной. */
export async function createCampaign(name: string, state: GameState): Promise<string> {
	let id = slug(name);
	let n = 1;
	while (campaigns.campaigns.some((c) => c.id === id)) id = `${slug(name)}-${++n}`;
	campaigns.campaigns.push({ id, name });
	campaigns.activeId = id;
	game.state = state;
	game.lastApply = null;
	await saveMeta();
	await persist();
	return id;
}

/** Переключиться на кампанию. */
export async function switchCampaign(id: string): Promise<void> {
	if (!store) return;
	campaigns.activeId = id;
	const saved = await store.get(stateKey(id));
	game.state = saved ? migrate(saved).state : null;
	game.lastApply = null;
	await saveMeta();
}

/** Удалить кампанию (и её слот). */
export async function deleteCampaign(id: string): Promise<void> {
	if (!store) return;
	await store.delete(stateKey(id));
	campaigns.campaigns = campaigns.campaigns.filter((c) => c.id !== id);
	if (campaigns.activeId === id) {
		campaigns.activeId = campaigns.campaigns[0]?.id ?? null;
		game.state = campaigns.activeId ? migrate((await store.get(stateKey(campaigns.activeId)))!).state : null;
	}
	await saveMeta();
}

/** Импорт сейв-бандла (JSON-канон) — «загрузка как в любой игре». Возвращает ошибку или null. */
export async function importBundle(jsonText: string): Promise<string | null> {
	try {
		const raw = JSON.parse(jsonText);
		const canon = typeof raw === 'object' && raw && 'canon.json' in raw ? JSON.parse((raw as Record<string, string>)['canon.json']!) : raw;
		const res = migrate(canon);
		const name = res.state.character?.core?.name ?? 'Загруженная';
		if (campaigns.activeId) {
			game.state = res.state;
			game.lastApply = null;
			await persist();
		} else {
			await createCampaign(name, res.state);
		}
		return null;
	} catch (e) {
		return (e as Error).message;
	}
}

export async function persist(): Promise<void> {
	if (store && game.state && campaigns.activeId) {
		await store.set(stateKey(campaigns.activeId), $state.snapshot(game.state));
	}
}

/** Применить операции хода через движок; обновить состояние и сохранить. */
export async function applyTurn(ops: Op[]): Promise<ApplyResult | null> {
	if (!game.state) return null;
	const res = engineApply($state.snapshot(game.state), ops, { day: game.state.session.day });
	game.state = res.state;
	game.lastApply = res;
	await persist();
	return res;
}

/** Временный стартовый персонаж (до флоу создания, Фаза 2). */
export function newGame(): GameState {
	const state: GameState = {
		schema_version: SCHEMA_VERSION,
		character: {
			core: {
				name: 'Безымянный',
				race: 'человек',
				age: 28,
				directions: ['наёмник'],
				attrs: { STR: 13, DEX: 13, CON: 12, INT: 10, PER: 11, CHA: 10 },
				hp: { cur: 72, max: 72 },
				stamina: { cur: 120, max: 120 },
				statuses: [],
				features: ['Привычен к дороге'],
				specializations: [],
				reputation: [
					{ faction: 'простолюдины', tier: 'Нейтрален', hidden: { доверие: 0, страх: 0, долг: 0, вражда: 0, романтика: 0 } }
				],
				renown: 0,
				updated_day: 1
			},
			modules: {
				combat_mastery: { weapons: ['короткий меч', 'кинжал'], features: [], hidden_level: 1 }
			}
		},
		inventory: {
			items: [
				{ id: 'it_korotkij-mech_0', name: 'Короткий меч', qty: 1, slot: 'надето', magical: false, acquired_day: 1 },
				{ id: 'it_kinzhal_1', name: 'Кинжал', qty: 1, slot: 'надето', magical: false, acquired_day: 1 },
				{ id: 'it_dorozhnyj-paek_2', name: 'Дорожный паёк (неделя)', qty: 1, slot: 'сумка', magical: false, acquired_day: 1 }
			],
			capital_mp: 450, // 45 SP — малый стартовый капитал (норма мира)
			journal: [{ day: 1, delta: 450, reason: 'стартовый капитал' }]
		},
		facts: [],
		npc: [],
		relationships: [],
		contracts: [],
		locations: [],
		timers: [],
		chronicle: [],
		seeds: [],
		arcs: [],
		session: {
			day: 1,
			time_of_day: 'утро',
			season: 'весна',
			weather: 'ясно, прохладно',
			current_moment: 'Таверна на окраине торгового города. Ты ищешь работу.',
			npcs_in_scene: [],
			open_threads: []
		}
	};
	game.state = state;
	void persist();
	return state;
}

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

export interface CombatOutcome {
	cues: string[];
	ended: boolean;
	victory: boolean;
	heroDown: boolean;
}

/** Разрешить боевой обмен по намерению игрока (если идёт бой). null — боя нет. */
export async function resolveCombat(playerText: string): Promise<CombatOutcome | null> {
	if (!game.state?.combat) return null;
	const { style, flee } = parseStyle(playerText);
	const rng = makeRng(seedFromString(`combat|${game.state.session.day}|${game.state.combat.round}|${playerText.length}`));
	const r = resolveExchange($state.snapshot(game.state), game.state.combat, { style, flee }, rng);
	// mechanics (раздел 22): исход обмена (скрытая кухня боя для /ask).
	logEvent('mechanics', { kind: 'combat_exchange', round: game.state.combat.round, style, flee, heroHpDelta: r.heroHpDelta, ended: r.ended, victory: r.victory });

	// Применяем урон/выносливость + практику боя через движок (журналируется, клампится).
	const ops: Op[] = [{ op: 'progress.tick', activity: 'combat' }];
	if (r.heroHpDelta) ops.push({ op: 'hp.change', delta: r.heroHpDelta, reason: 'бой' });
	if (r.staminaDelta) ops.push({ op: 'stamina.change', delta: r.staminaDelta, reason: 'бой' });
	const before = game.state.character.core.features.length;
	const applied = engineApply($state.snapshot(game.state), ops, { day: game.state.session.day });
	game.state = applied.state;
	const cues = [...r.cues];
	const newFeatures = game.state.character.core.features.slice(before);
	for (const f of newFeatures) cues.push(`Ты чувствуешь, что окреп: «${f}».`);
	game.state.combat = r.ended ? (undefined as never) : r.encounter;
	await persist();
	return { cues, ended: r.ended, victory: r.victory, heroDown: r.heroDown };
}

/** Проверить и развернуть сработавшие seeds на текущий день (каждый ход). */
export async function checkSeedsNow(): Promise<string[]> {
	if (!game.state) return [];
	const day = game.state.session.day;
	const rng = makeRng(seedFromString(`seeds|${day}|${game.state.seeds.length}`));
	const res = tickSeeds($state.snapshot(game.state), day, rng);
	if (res.fired.length) {
		game.state = res.state;
		await persist();
	}
	return res.fired.map((f) => f.description);
}

/** Офлайн-тик мира (между арками): фракции двигаются, рождаются слухи/seeds. */
export async function worldTick(): Promise<string[]> {
	if (!game.state) return [];
	const rng = makeRng(seedFromString(`world|${game.state.session.day}|${game.state.facts.length}`));
	const res = tickWorld($state.snapshot(game.state), rng);
	game.state = res.state;
	await persist();
	return res.rumors;
}

/** Режиссёр выбирает арку из неиспользованной комбинации (детерминированно) и фиксирует её. */
export async function directorPropose(): Promise<ProposedArc | null> {
	if (!game.state) return null;
	const rng = makeRng(seedFromString(`arc|${game.state.arcs.length}|${game.state.session.day}`));
	const arc = pickNextArc(game.state.arcs, rng);
	beginArc(game.state, arc);
	await persist();
	return arc;
}

/** Принять состояние (из git/импорта) в активную кампанию или создать новую. */
export async function commitState(state: GameState): Promise<void> {
	if (campaigns.activeId) {
		game.state = state;
		game.lastApply = null;
		await persist();
	} else {
		await createCampaign(state.character?.core?.name ?? 'Кампания', state);
	}
}

export function hasGame(): boolean {
	return game.state !== null;
}
