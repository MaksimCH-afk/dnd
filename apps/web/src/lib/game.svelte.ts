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
	if (saved) game.state = saved;
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

export function hasGame(): boolean {
	return game.state !== null;
}
