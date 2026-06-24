/**
 * Художественная обёртка хука Режиссёра (ТЗ §12, B5). Анти-повтор и выбор
 * комбинации осей — детерминированно в движке (pickNextArc). Здесь роль `director`
 * превращает выбранную комбинацию в живую завязку. Вне горячего пути хода.
 * Фоллбэк — шаблонный хук движка при ошибке/без сети.
 */

import type { ChatMessage, GameState, ProposedArc } from '@rpg/engine';
import { streamLlm } from './llm';

function buildMessages(arc: ProposedArc, state: GameState): ChatMessage[] {
	const c = state.character.core;
	const system = `Ты — Режиссёр истории (не рассказчик сцены). Тебе дана ДЕТЕРМИНИРОВАННО выбранная
комбинация осей будущей арки — НЕ меняй её. Преврати её в один мягкий хук-завязку: 2–4 предложения
атмосферной прозы на русском, как возможность/угроза на горизонте, НЕ приказ и без спойлеров механики.
Только проза хука, без преамбул.`;
	const user = `Оси арки (зафиксированы): тема=${arc.combo.theme}, фракция=${arc.combo.faction}, регион=${arc.combo.region}, антагонист=${arc.combo.antagonist}, структура=${arc.combo.structure}.
Герой: ${c.name}, ${c.race}, ${c.directions.join('/')}. День ${state.session.day}, ${state.session.current_moment}.
Шаблон-черновик (можешь переписать живее, не меняя оси): ${arc.hook}`;
	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

/** Сгенерировать живой хук по выбранной движком комбинации. Фоллбэк — шаблон. */
export async function composeHook(proxyUrl: string, arc: ProposedArc, state: GameState): Promise<string> {
	try {
		const text = await streamLlm(proxyUrl, 'director', buildMessages(arc, state), {});
		const trimmed = text.trim();
		return trimmed.length > 0 ? trimmed : arc.hook;
	} catch {
		return arc.hook;
	}
}
