/**
 * Отложенные последствия (ТЗ §9.10, чинит №1): мир помнит. seeds срабатывают по
 * условиям (время/локация/порог фракции/случай/флаг) и разворачиваются в события.
 * Лучшие последствия — отложенные; баланс держит конфиг частоты.
 */

import type { Rng } from './rng';
import type { GameState, Seed } from './state';

/** Сработал ли seed на данный день. */
export function seedFires(seed: Seed, state: GameState, day: number, rng: Rng): boolean {
	const p = seed.trigger.params;
	switch (seed.trigger.type) {
		case 'time':
			return typeof p.due_day === 'number' && day >= p.due_day;
		case 'location':
			return state.session.location_id != null && state.session.location_id === p.location_id;
		case 'faction_threshold': {
			const f = state.world_state?.factions.find((x) => x.name === p.faction);
			return f != null && typeof p.power === 'number' && (p.gte ? f.power >= p.power : f.power <= p.power);
		}
		case 'random':
			return rng.next() < (typeof p.chance === 'number' ? p.chance : 0.1);
		case 'flag':
			return state.facts.some((fct) => fct.tags.includes(String(p.flag)));
		default:
			return false;
	}
}

export interface SeedTickResult {
	state: GameState;
	fired: Seed[];
}

/**
 * Проверяет и разворачивает сработавшие seeds: удаляет их и добавляет
 * public-факт (слух/событие) из payload.text или описания. Чистая (новое состояние).
 */
export function tickSeeds(prev: GameState, day: number, rng: Rng): SeedTickResult {
	const state = structuredClone(prev);
	const fired: Seed[] = [];
	const remaining: Seed[] = [];

	for (const seed of state.seeds) {
		if (seedFires(seed, state, day, rng)) {
			fired.push(seed);
			const text = typeof seed.payload?.text === 'string' ? seed.payload.text : seed.description;
			state.facts.push({
				id: `f_${state.facts.length}`,
				text,
				scope: 'public',
				known_by: [],
				tags: ['seed', ...seed.tags],
				created_day: day
			});
			state.chronicle.push({ day, event: `Сработал отложенный сюжет: ${seed.description}`, applied_ops: ['seed.fire'] });
		} else {
			remaining.push(seed);
		}
	}
	state.seeds = remaining;
	return { state, fired };
}
