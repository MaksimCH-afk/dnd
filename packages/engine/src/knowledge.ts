/**
 * Модель знания (ТЗ §4.5, решает №3): NPC знает факт, только если он public
 * или конкретный NPC в его `known_by`. Скрытые поля героя (настоящее имя, тайная
 * школа, прикрытие) физически не попадают в контекст рассуждения NPC.
 *
 * Узнавание тайны героя — производное от факта в `known_by` И/ИЛИ известности
 * (ТЗ §9.4): тайный некромант с известностью «неизвестен» не опознаётся
 * случайным трактирщиком по построению.
 */

import type { Fact, GameState, Npc } from './state';

/** Знает ли NPC данный факт. */
export function npcKnowsFact(npcId: string, fact: Fact): boolean {
	if (fact.scope === 'public') return true;
	if (fact.scope === 'secret') return fact.known_by.includes(npcId);
	if (fact.scope === 'player') return false; // только игрок/герой
	// scope === `npc:<id>`
	return fact.known_by.includes(npcId) || fact.scope === `npc:${npcId}`;
}

/** Все факты, известные конкретному NPC. */
export function factsKnownBy(state: GameState, npcId: string): Fact[] {
	return state.facts.filter((f) => npcKnowsFact(npcId, f));
}

/** Порог известности, при котором героя узнают «в лицо/по делам». */
export const RENOWN_RECOGNITION_THRESHOLD = 5;

/**
 * Опознаёт ли NPC тайну героя. true, если:
 *  - есть факт с тегом секрета, и NPC в его `known_by`, ИЛИ
 *  - известность героя достаточно высока (слава объясняет узнавание).
 */
export function npcRecognizesHeroSecret(state: GameState, npcId: string, secretTag = 'hero_secret'): boolean {
	const byFact = state.facts.some(
		(f) => f.tags.includes(secretTag) && f.known_by.includes(npcId)
	);
	const byRenown = state.character.core.renown >= RENOWN_RECOGNITION_THRESHOLD;
	return byFact || byRenown;
}

export interface NpcContext {
	id: string;
	/** Запертое ядро — отдаётся дословно (защита от дрейфа, №4). */
	core: Npc['core'];
	living: Npc['living'];
	/** Факты, доступные знанию этого NPC (scope-ограничено). */
	known_facts: string[];
	/** Опознаёт ли тайну героя. */
	recognizes_hero_secret: boolean;
}

/**
 * Ограниченный контекст для рассуждения/реплики NPC: запертое ядро + живой слой
 * + только известные ему факты. Скрытое от него отсутствует физически (№3).
 */
export function buildNpcContext(state: GameState, npcId: string): NpcContext | null {
	const npc = state.npc.find((n) => n.id === npcId);
	if (!npc) return null;
	return {
		id: npc.id,
		core: npc.core,
		living: npc.living,
		known_facts: factsKnownBy(state, npcId).map((f) => f.text),
		recognizes_hero_secret: npcRecognizesHeroSecret(state, npcId)
	};
}

/**
 * Публичный вид героя для NPC, который НЕ знает его тайн: видимое (раса, вид),
 * без настоящего имени и секретов. Узнавание тайны добавляется отдельно при
 * recognizes_hero_secret.
 */
export function heroPublicView(state: GameState): string {
	const c = state.character.core;
	const visibleName = c.renown >= RENOWN_RECOGNITION_THRESHOLD ? c.name : 'незнакомец';
	return `${visibleName}, ${c.race}, ${c.directions.join('/')} по виду`;
}
