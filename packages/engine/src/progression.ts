/**
 * Прогрессия слой 1 (ТЗ §9.11, progression.md): скрытые счётчики практики растут
 * тихо; на вехах движок выдаёт особенности словами (слой 2) редко и художественно.
 * Слой 3 (специализации) — через specialization.offer после критических событий.
 */

import type { ModuleName } from './state';

export interface FeatureThreshold {
	activity: string;
	count: number;
	feature: string;
	/** Требуемый активный модуль (если особенность профильная). */
	requiresModule?: ModuleName;
}

/** Пороги выдачи особенностей. Редко и по нарастающей (progression.md). */
export const FEATURE_THRESHOLDS: FeatureThreshold[] = [
	{ activity: 'combat', count: 6, feature: 'Закалён в бою', requiresModule: 'combat_mastery' },
	{ activity: 'combat', count: 18, feature: 'Опытный боец', requiresModule: 'combat_mastery' },
	{ activity: 'combat', count: 40, feature: 'Ветеран многих схваток', requiresModule: 'combat_mastery' },
	{ activity: 'cast', count: 6, feature: 'Уверенный в касте', requiresModule: 'magic' },
	{ activity: 'cast', count: 18, feature: 'Искусный маг', requiresModule: 'magic' },
	{ activity: 'persuade', count: 6, feature: 'Опытный переговорщик' },
	{ activity: 'persuade', count: 16, feature: 'Мастер слова' },
	{ activity: 'stealth', count: 8, feature: 'Тихий шаг', requiresModule: 'intrigue' },
	{ activity: 'craft', count: 10, feature: 'Набил руку в ремесле', requiresModule: 'craft' }
];

/**
 * Какие особенности разблокированы при достижении счётчика activity=count.
 * Возвращает пороги, ровно совпавшие с новым значением (срабатывают один раз).
 */
export function unlockedAt(activity: string, count: number): FeatureThreshold[] {
	return FEATURE_THRESHOLDS.filter((t) => t.activity === activity && t.count === count);
}
