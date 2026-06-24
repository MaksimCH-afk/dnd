/**
 * Сборка промпта Ведущего (ТЗ §7.2). Фаза 1: статический системный промпт
 * (философия + протокол операций + активные модули) + scoped-срез состояния
 * + история. Полные выдержки правил из RulesStore и RAG-контекст — фазы 3–4.
 */

import type { ChatMessage, GameState } from '@rpg/engine';
import { activeModules, buildNpcContext } from '@rpg/engine';
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
feature.grant{name,description}, fact.add{text,scope,known_by,tags},
npc.spawn{seed_card:{id,name,race,role,character,motivation,appearance}},
npc.relationship{from,to,axis,delta,notes}, reputation.shift{faction,axis,delta,reason},
contract.offer{fields:{id,title,objectives,reward,deadline_day,faction}},
contract.update{id,fields}, contract.close{id,status}, timer.add{label,due_day,type},
combat.start{enemies:[{name,tier:слабый|обычный|опытный|монстр,weapon}]} (начать бой — урон/исход посчитает движок), combat.end,
progress.tick{activity:persuade|stealth|craft|cast} (отметь значимую практику — движок сам выдаст особенность на вехе),
power.set{state} (если маг), heat.change{delta,reason} (если intrigue), faith.shift{delta,reason} (если faith).
scope фактов: public (все знают) | secret (только перечисленные в known_by) | player (только герой).
ВАЖНО: NPC не может знать тайны героя, если они не в его known_by. Предлагай только реально произошедшее. Без блока — если состояние не менялось.`;

/**
 * Полные карточки NPC в сцене — ДОСЛОВНО (ТЗ §4.6, защита от дрейфа №4).
 * Скрытые поля героя сюда не попадают; NPC получает только своё ядро + что он знает.
 */
function sceneNpcCards(state: GameState): string {
	const cards = state.session.npcs_in_scene
		.map((id) => buildNpcContext(state, id))
		.filter((c): c is NonNullable<typeof c> => c !== null)
		.map((c) => {
			const known = c.known_facts.length ? `\n  знает: ${c.known_facts.join('; ')}` : '';
			const recog = c.recognizes_hero_secret ? '' : '\n  (тайн героя НЕ знает — не ссылайся на них)';
			return `• ${c.core.name} — ${c.core.race}, ${c.core.age}, ${c.core.role} (${c.core.estate}).
  характер: ${c.core.character}; речь: ${c.core.speech_register}; мотивация: ${c.core.motivation}.
  настроение: ${c.living.mood}; внешность: ${c.core.appearance}.${known}${recog}`;
		});
	return cards.length ? `NPC В СЦЕНЕ (веди их строго по карточкам, без отсебятины):\n${cards.join('\n')}` : '';
}

function activeContracts(state: GameState): string {
	const open = state.contracts.filter((c) => c.status === 'предложен' || c.status === 'активен');
	if (!open.length) return '';
	return `Контракты: ${open.map((c) => `«${c.title}» (${c.status}${c.deadline_day ? `, до Дня ${c.deadline_day}` : ''})`).join('; ')}`;
}

function activeTimers(state: GameState): string {
	if (!state.timers.length) return '';
	return `Таймеры: ${state.timers.map((t) => `${t.label} → День ${t.due_day}`).join('; ')}`;
}

function stateContext(state: GameState, retrieved: string[]): string {
	const c = state.character.core;
	const s = state.session;
	const status = statusFields(state)
		.map((f) => `${f.label}: ${f.value}`)
		.join(' · ');
	const inv = state.inventory.items
		.map((i) => `${i.name}${i.qty > 1 ? `×${i.qty}` : ''} [${i.id}]`)
		.join(', ');
	const rag = retrieved.length ? `Релевантное из памяти мира:\n${retrieved.map((r) => `- ${r}`).join('\n')}` : '';
	return [
		`СОСТОЯНИЕ (источник истины, не выдумывай сверх него):`,
		`Персонаж: ${c.name}, ${c.race}, ${c.age}, ${c.directions.join('/')}.`,
		`Активные модули: ${activeModules(state).join(', ') || 'нет'}.`,
		`Статус: ${status}.`,
		c.features.length ? `Особенности: ${c.features.join(', ')}.` : '',
		`Инвентарь: ${inv || 'пусто'}.`,
		`Сцена: День ${s.day}, ${s.time_of_day}, ${s.season}. ${s.weather ?? ''}`,
		`Момент: ${s.current_moment}`,
		activeContracts(state),
		activeTimers(state),
		sceneNpcCards(state),
		rag
	]
		.filter(Boolean)
		.join('\n');
}

export function buildNarratorMessages(
	state: GameState,
	entries: ChronicleEntry[],
	playerInput: string,
	retrieved: string[] = [],
	outcomes: string[] = []
): ChatMessage[] {
	const outcomeBlock = outcomes.length
		? `\n\nИСХОД ДЕЙСТВИЯ ОТ ДВИЖКА (опиши именно это, НЕ придумывай иной результат, не называй числа/секунды):\n${outcomes.map((o) => `- ${o}`).join('\n')}`
		: '';
	const messages: ChatMessage[] = [
		{ role: 'system', content: `${PHILOSOPHY}\n\n${OPS_PROTOCOL}\n\n${stateContext(state, retrieved)}${outcomeBlock}` }
	];

	const recent = entries.filter((e) => e.speaker !== 'system').slice(-HISTORY_LIMIT);
	for (const e of recent) {
		messages.push({ role: e.speaker === 'player' ? 'user' : 'assistant', content: e.text });
	}
	messages.push({ role: 'user', content: playerInput });
	return messages;
}
