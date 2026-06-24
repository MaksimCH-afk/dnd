/**
 * LLM-валидатор семантических утечек знания (ТЗ §7.3, §22 validation).
 * Детерминированный scope уже не пускает скрытые факты в промпт; это вторая,
 * семантическая страховка: читает прозу и ловит, не сослался ли NPC на знание,
 * которого у него нет. Опционально (+1 вызов модели), gated настройкой.
 */

import { buildNpcContext, type ChatMessage, type GameState } from '@rpg/engine';
import { streamLlm } from './llm';

export interface LeakVerdict {
	leak: boolean;
	detail: string;
	model?: string;
}

function buildMessages(prose: string, state: GameState): ChatMessage[] {
	const npcs = state.session.npcs_in_scene
		.map((id) => buildNpcContext(state, id))
		.filter((c): c is NonNullable<typeof c> => c !== null);

	const knowledge = npcs
		.map((c) => {
			const facts = c.known_facts.length ? c.known_facts.join('; ') : '(только общеизвестное и наблюдаемое)';
			const secret = c.recognizes_hero_secret ? 'знает тайны героя' : 'НЕ знает тайн героя';
			return `• ${c.core.name}: ${secret}. Известно: ${facts}.`;
		})
		.join('\n');

	const heroSecrets = state.facts
		.filter((f) => f.scope === 'secret' || f.scope === 'player')
		.map((f) => f.text)
		.join('; ');

	const system = `Ты — детерминированный валидатор знания (не рассказчик). Тебе дан фрагмент сцены и то,
что КАЖДЫЙ NPC реально знает. Найди утечку: NPC упомянул/использовал знание вне своего списка
(особенно тайны героя), которого не мог получить наблюдением в сцене.
Ответь СТРОГО одной строкой JSON, без пояснений: {"leak": true|false, "detail": "кратко что и у кого"}.
Если всё чисто — {"leak": false, "detail": ""}.`;

	const user = `ЗНАНИЕ NPC В СЦЕНЕ:\n${knowledge || '(NPC в сцене нет)'}\n\nТАЙНЫ ГЕРОЯ (никто не должен их знать без отметки выше):\n${heroSecrets || '(нет)'}\n\nТЕКСТ СЦЕНЫ:\n${prose}`;

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

function parseVerdict(text: string): LeakVerdict {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) return { leak: false, detail: '' };
	try {
		const o = JSON.parse(m[0]) as { leak?: unknown; detail?: unknown };
		return { leak: o.leak === true, detail: typeof o.detail === 'string' ? o.detail : '' };
	} catch {
		return { leak: false, detail: '' };
	}
}

/** Проверить прозу на утечку знания. Возвращает вердикт (leak=false при ошибке/без сети). */
export async function validateLeak(proxyUrl: string, prose: string, state: GameState): Promise<LeakVerdict> {
	if (!state.session.npcs_in_scene.length) return { leak: false, detail: '' };
	let model = '';
	try {
		const text = await streamLlm(proxyUrl, 'validator', buildMessages(prose, state), {
			onDone: (e) => (model = e.meta.model)
		});
		return { ...parseVerdict(text), model };
	} catch {
		return { leak: false, detail: '' };
	}
}
