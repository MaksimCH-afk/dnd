/**
 * Мир-симуляция (ТЗ §12, чинит №1): офлайн-тики по мировым часам. Фракции/регионы
 * двигаются сами, порождают public-факты/слухи и новые seeds. Новизна — из
 * симуляции, не из выдумки. Частоту/вес ограничивает конфиг.
 */

import type { Rng } from './rng';
import type { GameState, WorldState } from './state';

export function defaultWorldState(day: number): WorldState {
	return {
		clock_day: day,
		factions: [
			{ name: 'Церковь Солнца', power: 7, mood: 'бдительна' },
			{ name: 'Орден Луны', power: 5, mood: 'занят наукой' },
			{ name: 'криминал', power: 4, mood: 'осторожен' },
			{ name: 'знать', power: 6, mood: 'интригует' },
			{ name: 'тёмный культ', power: 2, mood: 'в тени' }
		],
		regions: [
			{ name: 'Центральные земли', notes: 'относительная стабильность' },
			{ name: 'Север', notes: 'набеги с дальнего севера' }
		]
	};
}

const EVENTS = [
	'усиливает влияние',
	'теряет позиции',
	'затевает интригу',
	'ищет союзников',
	'готовит расправу над соперником',
	'распускает слухи'
];

export interface WorldTickResult {
	state: GameState;
	rumors: string[];
}

/**
 * Тик мира: продвигает мировые часы к текущему дню, нудж силы случайной фракции,
 * порождает 0–2 слуха (public-факты) и иногда seed. Лимит событий ограничен.
 */
export function tickWorld(prev: GameState, rng: Rng, maxEvents = 2): WorldTickResult {
	const state = structuredClone(prev);
	if (!state.world_state) state.world_state = defaultWorldState(state.session.day);
	const ws = state.world_state;
	ws.clock_day = state.session.day;

	const rumors: string[] = [];
	const n = rng.int(0, maxEvents);
	for (let i = 0; i < n; i++) {
		const faction = rng.pick(ws.factions);
		const event = rng.pick(EVENTS);
		faction.power = Math.max(0, Math.min(10, faction.power + rng.int(-1, 1)));
		const rumor = `Поговаривают, что «${faction.name}» ${event}.`;
		rumors.push(rumor);
		state.facts.push({
			id: `f_${state.facts.length}`,
			text: rumor,
			scope: 'public',
			known_by: [],
			tags: ['слух', 'мир-симуляция'],
			created_day: state.session.day
		});
		// Иногда событие сеет отложенное последствие.
		if (rng.chance(0.35)) {
			state.seeds.push({
				id: `seed_${state.seeds.length}`,
				description: `${faction.name}: ${event} — отзовётся позже`,
				trigger: { type: 'time', params: { due_day: state.session.day + rng.int(3, 14) } },
				payload: { text: `Последствия: ${faction.name} ${event}.` },
				tags: ['мир-симуляция', faction.name],
				planted_day: state.session.day
			});
		}
	}
	return { state, rumors };
}
