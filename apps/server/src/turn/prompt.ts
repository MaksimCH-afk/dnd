/** Сборка промпта Ведущего (порт с клиента, ТЗ §7.2). История — из state.transcript. */
import type { ChatMessage, GameState } from '@rpg/engine';
import { activeModules, buildNpcContext } from '@rpg/engine';
import { statusFields } from './status';
import { heroSecretTokens, heroHiddenTraits } from './leak';

const HISTORY_LIMIT = 10;

const PHILOSOPHY = `Ты — Мастер-рассказчик одиночной текстовой ролевой игры в тёмном эпическом фэнтези.
Веди игру на русском, атмосферной прозой через пять чувств.

Железные правила (master.md):
- ОБРАЩАЙСЯ К ГЕРОЮ НА «ТЫ», во втором лице: «ты видишь…», «ты слышишь…», «перед тобой…».
  НЕ веди рассказ в третьем лице и НЕ называй героя по имени как стороннего.
- НИКОГДА не действуй за игрока: описывай мир, NPC и последствия — выбор за игроком. Останавливайся там, где нужно его решение.
- НЕ выдумывай числа (капитал, HP, цены) и факты. Состояние — ниже; механику считает движок.
- НЕ бросай кости и не называй DC. Исход придёт от движка.
- Мир тёмный и взрослый по дизайну (инквизиция, кровь, культы) — это художественная зрелость.
- Последствия подавай нарративом, не таблицей.`;

const OPS_PROTOCOL = `ПРЕДЛОЖЕНИЕ ИЗМЕНЕНИЙ СОСТОЯНИЯ.
Если ход меняет состояние, в КОНЦЕ ответа добавь блок (игрок его не видит как часть истории):
\`\`\`ops
[ {"op":"capital.change","delta":-120,"reason":"еда в таверне"} ]
\`\`\`
Операции: capital.change{delta,reason} (delta в медных MP: 1 SP=10 MP, 1 GP=100 MP),
item.add{item:{name,qty,slot:надето|сумка|схрон,magical?,charges?}}, item.remove{id,qty,reason},
item.update{id,fields}, hp.change{delta,reason}, stamina.change{delta,reason}, status.add{effect},
status.remove{effect}, feature.grant{name,description}, fact.add{text,scope,known_by,tags},
npc.spawn{seed_card:{id,name,race,role,character,motivation,appearance}},
npc.relationship{from,to,axis,delta,notes}, reputation.shift{faction,axis,delta,reason},
contract.offer{fields:{id,title,objectives,reward,deadline_day,faction}}, contract.update{id,fields},
contract.close{id,status}, timer.add{label,due_day,type},
combat.start{enemies:[{name,tier:слабый|обычный|опытный|монстр,weapon}]}, combat.end,
progress.tick{activity:persuade|stealth|craft|cast},
power.set{state} (если маг), heat.change{delta,reason} (если intrigue), faith.shift{delta,reason} (если faith).
scope фактов: public | secret (только known_by) | player. NPC не может знать тайны героя вне known_by.
Без блока — если состояние не менялось.`;

function sceneNpcCards(state: GameState): string {
	// Что НЕ должны раскрывать NPC, не знающие героя (баг №3, уровень 1a).
	const secrets = [...heroSecretTokens(state), ...heroHiddenTraits(state)];
	const mustNotKnow = secrets.length ? `\n  НЕ ЗНАЕТ и НЕ упоминает: ${secrets.join('; ')}` : '';
	const cards = state.session.npcs_in_scene
		.map((id) => buildNpcContext(state, id))
		.filter((c): c is NonNullable<typeof c> => c !== null)
		.map((c) => {
			const known = c.known_facts.length ? `\n  знает: ${c.known_facts.join('; ')}` : '';
			const recog = c.recognizes_hero_secret ? '' : mustNotKnow;
			return `• ${c.core.name} — ${c.core.race}, ${c.core.age}, ${c.core.role}. характер: ${c.core.character}; мотивация: ${c.core.motivation}; настроение: ${c.living.mood}.${known}${recog}`;
		});
	if (!cards.length) return '';
	return (
		`NPC В СЦЕНЕ (веди строго по карточкам):\n${cards.join('\n')}\n` +
		`ЖЕЛЕЗНО: NPC говорит и действует только из того, что знает. Кто не знает тайн героя — ` +
		`не намекает на них, не узнаёт «того самого», не называет настоящее имя/прикрытие/скрытую школу.`
	);
}

function activeContracts(state: GameState): string {
	const open = state.contracts.filter((c) => c.status === 'предложен' || c.status === 'активен');
	return open.length ? `Контракты: ${open.map((c) => `«${c.title}» (${c.status}${c.deadline_day ? `, до Дня ${c.deadline_day}` : ''})`).join('; ')}` : '';
}

function stateContext(state: GameState, retrieved: string[]): string {
	const c = state.character.core;
	const s = state.session;
	const status = statusFields(state).map((f) => `${f.label}: ${f.value}`).join(' · ');
	const inv = state.inventory.items.map((i) => `${i.name}${i.qty > 1 ? `×${i.qty}` : ''} [${i.id}]`).join(', ');
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
		sceneNpcCards(state),
		rag
	]
		.filter(Boolean)
		.join('\n');
}

export function buildNarratorMessages(
	state: GameState,
	input: string,
	retrieved: string[] = [],
	outcomes: string[] = []
): ChatMessage[] {
	const outcomeBlock = outcomes.length
		? `\n\nИСХОД ДЕЙСТВИЯ ОТ ДВИЖКА (опиши именно это, НЕ придумывай иной результат, не называй числа/секунды):\n${outcomes.map((o) => `- ${o}`).join('\n')}`
		: '';
	const messages: ChatMessage[] = [
		{ role: 'system', content: `${PHILOSOPHY}\n\n${OPS_PROTOCOL}\n\n${stateContext(state, retrieved)}${outcomeBlock}` }
	];
	const recent = (state.transcript ?? []).filter((e) => e.speaker !== 'system').slice(-HISTORY_LIMIT);
	for (const e of recent) messages.push({ role: e.speaker === 'player' ? 'user' : 'assistant', content: e.text });
	messages.push({ role: 'user', content: input });
	return messages;
}
