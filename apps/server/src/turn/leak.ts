/**
 * Защита от утечки тайн героя в прозе NPC (баг №3), по спеке validator_leak_check.
 * Детерминированный движок ограничивает, что NPC ХРАНИТ, но не видит прозу — поэтому
 * нужен скан текста. Уровень 1: точные токены-тайны (без вызова модели). Уровень 2
 * (в run.ts): семантическая проверка дешёвой моделью только на риск-ходах.
 */
import { RENOWN_RECOGNITION_THRESHOLD, npcRecognizesHeroSecret, type GameState } from '@rpg/engine';

/** Точные секретные токены героя (имена собственные/прикрытия) — для скана прозы и промпта. */
export function heroSecretTokens(state: GameState): string[] {
	const c = state.character;
	const core = c.core;
	const out = new Set<string>();
	if (core.true_name) out.add(core.true_name);
	if ((core.renown ?? 0) < RENOWN_RECOGNITION_THRESHOLD && core.name) out.add(core.name);
	for (const cov of c.modules.intrigue?.covers ?? []) if (cov) out.add(cov);
	return [...out].map((s) => s.trim()).filter((s) => s.length >= 3);
}

/** Краткое описание скрытых практик/школ — для блока «НЕ должен знать» и валидатора. */
export function heroHiddenTraits(state: GameState): string[] {
	const m = state.character.modules;
	const out: string[] = [];
	for (const da of m.magic?.dark_arcs ?? []) out.push(`тёмная практика: ${da.arc}${da.note ? ` (${da.note})` : ''}`);
	// Тайные/игроцкие факты — их текст известен только герою.
	for (const f of state.facts) {
		if (f.scope === 'player' || f.tags.includes('hero_secret')) out.push(f.text);
	}
	return out.slice(0, 8);
}

/** Есть ли в сцене NPC, который НЕ должен опознавать тайны героя. */
export function sceneHasBlindNpc(state: GameState): boolean {
	return state.session.npcs_in_scene.some(
		(id) => state.npc.some((n) => n.id === id) && !npcRecognizesHeroSecret(state, id)
	);
}

/** У героя вообще есть что скрывать? */
export function heroHasSecret(state: GameState): boolean {
	return heroSecretTokens(state).length > 0 || heroHiddenTraits(state).length > 0;
}

/** Уровень 1b: точные токены-тайны, всплывшие в прозе (без модели). */
export function scanLeakTokens(prose: string, tokens: string[]): string[] {
	const lp = prose.toLowerCase();
	return tokens.filter((t) => lp.includes(t.toLowerCase()));
}
