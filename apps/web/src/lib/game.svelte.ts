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
	SCHEMA_VERSION,
	type GameState,
	type Op,
	type ApplyResult
} from '@rpg/engine';
import { IdbStore } from './idb';

const store = browser ? new IdbStore<GameState>('rpg-game', 'state') : null;
const KEY = 'current';

export const game = $state<{ state: GameState | null; lastApply: ApplyResult | null }>({
	state: null,
	lastApply: null
});

export async function loadGame(): Promise<void> {
	if (!store) return;
	const saved = await store.get(KEY);
	if (saved) game.state = migrate(saved).state; // мигрируем старые сейвы (ТЗ §15)
}

/** Импорт сейв-бандла (JSON-канон) — «загрузка как в любой игре». Возвращает ошибку или null. */
export async function importBundle(jsonText: string): Promise<string | null> {
	try {
		const raw = JSON.parse(jsonText);
		const canon = typeof raw === 'object' && raw && 'canon.json' in raw ? JSON.parse((raw as Record<string, string>)['canon.json']!) : raw;
		const res = migrate(canon);
		game.state = res.state;
		game.lastApply = null;
		await persist();
		return null;
	} catch (e) {
		return (e as Error).message;
	}
}

export async function persist(): Promise<void> {
	if (store && game.state) await store.set(KEY, $state.snapshot(game.state));
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

/** Режиссёр предлагает следующую арку из неиспользованной комбинации (мягкий хук). */
export async function directorPropose(): Promise<string | null> {
	if (!game.state) return null;
	const rng = makeRng(seedFromString(`arc|${game.state.arcs.length}|${game.state.session.day}`));
	const arc = pickNextArc(game.state.arcs, rng);
	beginArc(game.state, arc);
	await persist();
	return arc.hook;
}

/** Принять созданное состояние (из флоу создания) и сохранить. */
export function commitState(state: GameState): void {
	game.state = state;
	game.lastApply = null;
	void persist();
}

export function hasGame(): boolean {
	return game.state !== null;
}
