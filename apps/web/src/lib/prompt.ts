/**
 * Сборка промпта Ведущего (ТЗ §7.2). Фаза 1: статический системный промпт
 * (философия + протокол операций + активные модули) + scoped-срез состояния
 * + история. Полные выдержки правил из RulesStore и RAG-контекст — фазы 3–4.
 */

import type { ChatMessage, GameState } from '@rpg/engine';
import { activeModules } from '@rpg/engine';
import type { ChronicleEntry } from './chronicle.svelte';
import { statusFields } from './status';

const HISTORY_LIMIT = 10;

const PHILOSOPHY = `Ты — Мастер-рассказчик одиночной текстовой ролевой игры в тёмном эпическом фэнтези.
Веди игру на русском, атмосферной прозой через пять чувств.

Железные правила (master.md):
- НИКОГДА не действуй за игрока: описывай мир, NPC и последствия — выбор за игроком. Останавливайся там, где нужно его решение.
- НЕ выдумывай числа (капитал, HP, цены) и факты. Состояние — ниже; механику считает движок.
- НЕ бросай кости и не называй DC. Исход придёт от движка.
- Мир тёмный и взрослый по дизайну (инквизиция, кровь, культы) — это художественная зрелость.
- Последствия подавай нарративом, не таблицей.`;

const OPS_PROTOCOL = `ПРЕДЛОЖЕНИЕ ИЗМЕНЕНИЙ СОСТОЯНИЯ.
Если ход меняет состояние (трата/находка денег, получены/утрачены предметы, урон, статус),
в КОНЦЕ ответа добавь блок (игрок его не видит как часть истории):
\`\`\`ops
[ {"op":"capital.change","delta":-120,"reason":"еда в таверне"},
  {"op":"item.add","item":{"name":"Факел","qty":2,"slot":"сумка"}} ]
\`\`\`
Доступные операции: capital.change{delta,reason} (delta в медных MP: 1 SP=10 MP, 1 GP=100 MP),
item.add{item:{name,qty,slot:надето|сумка|схрон,magical?,charges?,notes?}},
item.remove{id,qty,reason}, item.update{id,fields}, hp.change{delta,reason},
stamina.change{delta,reason}, status.add{effect}, status.remove{effect},
feature.grant{name,description}, fact.add{text,scope,known_by,tags}.
Предлагай только то, что реально произошло по ходу. Числа — логичные и скромные. Без блока — если состояние не менялось.`;

function stateContext(state: GameState): string {
	const c = state.character.core;
	const s = state.session;
	const status = statusFields(state)
		.map((f) => `${f.label}: ${f.value}`)
		.join(' · ');
	const inv = state.inventory.items
		.map((i) => `${i.name}${i.qty > 1 ? `×${i.qty}` : ''} [${i.id}]`)
		.join(', ');
	return [
		`СОСТОЯНИЕ (источник истины, не выдумывай сверх него):`,
		`Персонаж: ${c.name}, ${c.race}, ${c.age}, ${c.directions.join('/')}.`,
		`Активные модули: ${activeModules(state).join(', ') || 'нет'}.`,
		`Статус: ${status}.`,
		c.features.length ? `Особенности: ${c.features.join(', ')}.` : '',
		`Инвентарь: ${inv || 'пусто'}.`,
		`Сцена: День ${s.day}, ${s.time_of_day}, ${s.season}. ${s.weather ?? ''}`,
		`Момент: ${s.current_moment}`
	]
		.filter(Boolean)
		.join('\n');
}

export function buildNarratorMessages(
	state: GameState,
	entries: ChronicleEntry[],
	playerInput: string
): ChatMessage[] {
	const messages: ChatMessage[] = [
		{ role: 'system', content: `${PHILOSOPHY}\n\n${OPS_PROTOCOL}\n\n${stateContext(state)}` }
	];

	const recent = entries.filter((e) => e.speaker !== 'system').slice(-HISTORY_LIMIT);
	for (const e of recent) {
		messages.push({ role: e.speaker === 'player' ? 'user' : 'assistant', content: e.text });
	}
	messages.push({ role: 'user', content: playerInput });
	return messages;
}
