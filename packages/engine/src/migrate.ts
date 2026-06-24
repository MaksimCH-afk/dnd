/**
 * Миграции схемы сейвов (ТЗ §15): сейвы живут в git долго, при изменении схемы
 * старые версии мигрируются при загрузке. Цепочка шагов по schema_version +
 * защитное заполнение недостающих полей (forward-совместимость).
 */

import { SCHEMA_VERSION, type GameState } from './state';

type AnyState = Record<string, unknown>;

/** Шаг 0→1: гарантировать наличие всех коллекций/полей текущей схемы. */
function migrate0to1(s: AnyState): AnyState {
	const arrays = ['facts', 'npc', 'relationships', 'contracts', 'locations', 'timers', 'chronicle', 'seeds', 'arcs'];
	for (const k of arrays) if (!Array.isArray(s[k])) s[k] = [];

	const character = (s.character ?? {}) as AnyState;
	if (!character.modules) character.modules = {};
	if (!character.core) character.core = {};
	const core = character.core as AnyState;
	if (!Array.isArray(core.statuses)) core.statuses = [];
	if (!Array.isArray(core.features)) core.features = [];
	if (!Array.isArray(core.specializations)) core.specializations = [];
	if (!Array.isArray(core.reputation)) core.reputation = [];
	if (typeof core.renown !== 'number') core.renown = 0;
	s.character = character;

	const inv = (s.inventory ?? {}) as AnyState;
	if (!Array.isArray(inv.items)) inv.items = [];
	if (typeof inv.capital_mp !== 'number') inv.capital_mp = 0;
	if (!Array.isArray(inv.journal)) inv.journal = [];
	s.inventory = inv;

	if (!s.session) {
		s.session = { day: 1, time_of_day: 'утро', season: 'весна', current_moment: '', npcs_in_scene: [], open_threads: [] };
	}
	return s;
}

const STEPS: Record<number, (s: AnyState) => AnyState> = {
	0: migrate0to1
};

export interface MigrationResult {
	state: GameState;
	migratedFrom: number;
	changed: boolean;
}

/**
 * Привести загруженный сейв к текущей схеме. Идемпотентно: актуальный сейв
 * проходит только защитную проверку шага и не меняет версию.
 */
export function migrate(raw: unknown): MigrationResult {
	const s = (typeof raw === 'object' && raw !== null ? { ...(raw as AnyState) } : {}) as AnyState;
	const from = typeof s.schema_version === 'number' ? s.schema_version : 0;
	let v = from;
	let cur = s;
	while (v < SCHEMA_VERSION) {
		const step = STEPS[v];
		if (!step) break;
		cur = step(cur);
		v += 1;
	}
	// Защитное заполнение даже для актуальной версии (битые/частичные сейвы).
	if (from >= SCHEMA_VERSION) cur = migrate0to1(cur);
	cur.schema_version = SCHEMA_VERSION;
	return { state: cur as unknown as GameState, migratedFrom: from, changed: from < SCHEMA_VERSION };
}
