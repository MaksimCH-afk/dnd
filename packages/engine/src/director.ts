/**
 * Режиссёр (ТЗ §12, чинит №1): между арками выбирает следующую из НЕИСПОЛЬЗОВАННОЙ
 * комбинации матрицы осей, не повторяя motifs_used. Новизна — из комбинаторики и
 * мир-симуляции, а не из выдумки модели. Результат — мягкий хук, не приказ.
 *
 * Детерминированный выбор здесь; художественную обёртку даёт LLM-роль director.
 */

import type { Rng } from './rng';
import type { Arc, GameState } from './state';

export const ARC_AXES = {
	theme: ['месть', 'тайна', 'спасение', 'предательство', 'власть', 'выживание', 'искупление', 'жадность'],
	faction: ['Церковь Солнца', 'Орден Луны', 'криминал', 'знать', 'тёмный культ', 'простолюдины'],
	region: ['Центральные земли', 'Север', 'Юг', 'Запад', 'Глушь', 'Искажённые Земли'],
	antagonist: ['инквизитор', 'некромант', 'разбойник', 'интриган-аристократ', 'чудовище Надлома', 'двойник'],
	structure: ['расследование', 'оборона', 'погоня', 'переговоры', 'проникновение', 'ритуал']
} as const;

export interface ArcCombo {
	theme: string;
	faction: string;
	region: string;
	antagonist: string;
	structure: string;
}

export function comboKey(c: ArcCombo): string {
	return `${c.theme}|${c.faction}|${c.region}|${c.antagonist}|${c.structure}`;
}

/** Множество уже использованных мотивов (по всем аркам). */
export function usedMotifs(arcs: Arc[]): Set<string> {
	const set = new Set<string>();
	for (const a of arcs) for (const m of a.motifs_used) set.add(m);
	return set;
}

export interface ProposedArc {
	combo: ArcCombo;
	key: string;
	/** Мягкий хук для Ведущего (черновик; LLM-director может переписать). */
	hook: string;
	tags: string[];
}

/**
 * Подобрать следующую арку из неиспользованной комбинации. Пробует случайные
 * комбинации, избегая использованных мотивов-ключей; если пространство исчерпано
 * (очень маловероятно — 8×6×6×6×6=10368), берёт наименее похожую.
 */
export function pickNextArc(arcs: Arc[], rng: Rng, attempts = 96): ProposedArc {
	const used = usedMotifs(arcs);
	// Значения осей из недавних арок (последние 3) — чтобы новая арка ощущалась иной.
	const recentValues = new Set<string>();
	for (const a of arcs.slice(-3)) for (const t of a.tags) recentValues.add(t);

	let best: ArcCombo | null = null;
	let bestScore = -1;

	for (let i = 0; i < attempts; i++) {
		const combo: ArcCombo = {
			theme: rng.pick(ARC_AXES.theme),
			faction: rng.pick(ARC_AXES.faction),
			region: rng.pick(ARC_AXES.region),
			antagonist: rng.pick(ARC_AXES.antagonist),
			structure: rng.pick(ARC_AXES.structure)
		};
		if (used.has(comboKey(combo))) continue; // точный повтор — мимо
		// Чем меньше пересечение с недавними значениями осей — тем лучше.
		const overlap = [combo.theme, combo.faction, combo.region, combo.antagonist, combo.structure].filter((v) => recentValues.has(v)).length;
		const score = 5 - overlap;
		if (score > bestScore) {
			bestScore = score;
			best = combo;
			if (overlap === 0) break; // идеально — полностью свежая
		}
	}

	// Фоллбэк, если всё перебрали (пространство исчерпано).
	const combo =
		best ?? {
			theme: rng.pick(ARC_AXES.theme),
			faction: rng.pick(ARC_AXES.faction),
			region: rng.pick(ARC_AXES.region),
			antagonist: rng.pick(ARC_AXES.antagonist),
			structure: rng.pick(ARC_AXES.structure)
		};
	const key = comboKey(combo);
	const hook = `${combo.structure} в регионе «${combo.region}»: ${combo.theme} с участием «${combo.faction}»; за этим стоит ${combo.antagonist}.`;
	return { combo, key, hook, tags: [combo.theme, combo.faction, combo.region, combo.antagonist, combo.structure] };
}

/** Зафиксировать арку как начатую (добавить в arcs с её мотивом). */
export function beginArc(state: GameState, proposed: ProposedArc): Arc {
	const arc: Arc = { id: `arc_${state.arcs.length}`, tags: proposed.tags, motifs_used: [proposed.key] };
	state.arcs.push(arc);
	return arc;
}
