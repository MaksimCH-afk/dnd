/** Художественная обёртка хука Режиссёра (порт; анти-повтор — в движке pickNextArc). */
import type { GameState, ProposedArc } from '@rpg/engine';
import { complete } from '../openrouter';
import type { ServerConfig } from '../config';
import type { RuleInjector } from '../rules';

export async function composeHook(cfg: ServerConfig, arc: ProposedArc, state: GameState, rules?: RuleInjector): Promise<string> {
	const c = state.character.core;
	// Слой B для Режиссёра — банк завязок / лор мира (только при планировании арки, не каждый ход нарратору).
	const worldCtx = rules?.directorContext().trim();
	const bank = worldCtx ? `\n\nБанк завязок и тон мира (опирайся на него, выбирай неизбитое):\n${worldCtx.slice(0, 4000)}` : '';
	const system = `Ты — Режиссёр истории. Комбинация осей арки ЗАФИКСИРОВАНА — не меняй её. Преврати её в один
мягкий хук-завязку: 2–4 предложения атмосферной прозы на русском, возможность/угроза на горизонте, не приказ.
Обращайся к герою на «ты», не в третьем лице. Только проза хука.${bank}`;
	const user = `Оси: тема=${arc.combo.theme}, фракция=${arc.combo.faction}, регион=${arc.combo.region}, антагонист=${arc.combo.antagonist}, структура=${arc.combo.structure}.
Герой: ${c.name}, ${c.race}, ${c.directions.join('/')}. День ${state.session.day}, ${state.session.current_moment}.
Черновик (можешь переписать живее, не меняя оси): ${arc.hook}`;
	try {
		const text = (await complete(cfg, 'director', [
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		])).trim();
		return text || arc.hook;
	} catch {
		return arc.hook;
	}
}
