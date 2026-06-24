/**
 * Импорт игры из документов (лист персонажа / инвентарь / NPC / описание сессии).
 * LLM извлекает строгий профиль, а состояние собирается ВАЛИДИРОВАННЫМ путём движка:
 * createCharacter() + applyOps() (item.add / capital.change / npc.spawn). Так
 * импортированная партия — корректный GameState, а не вручную слепленный объект.
 */
import {
	createCharacter,
	applyOps,
	type CreationChoices,
	type GameState,
	type Op,
	type Race,
	type Direction,
	type ChatMessage
} from '@rpg/engine';
import { completeDetailed } from './openrouter';
import type { ServerConfig } from './config';

export interface ImportDocs {
	character: string;
	inventory: string;
	npcs: string;
	session: string;
}

const RACES: Race[] = ['человек', 'светлый эльф', 'тёмный эльф', 'гном', 'полурослик', 'орк', 'полуэльф'];
const DIRECTIONS: Direction[] = [
	'военный', 'наёмник', 'ремесленник', 'рабочий', 'торговец',
	'путешественник', 'преступник', 'академик', 'отшельник', 'жрец'
];
const AGE_BANDS = ['молодой', 'зрелый', 'пожилой'] as const;
const SLOTS = ['надето', 'сумка', 'схрон'] as const;
const TIMES = ['утро', 'день', 'вечер', 'ночь'] as const;
const SEASONS = ['зима', 'весна', 'лето', 'осень'] as const;

interface ImportProfile {
	creation: { name: string; race: string; age_band: string; direction: string; darkPath?: boolean };
	capital_mp?: number;
	inventory?: { name: string; qty?: number; slot?: string; magical?: boolean; charges?: number; notes?: string }[];
	npcs?: { name: string; race?: string; age?: number; role?: string; estate?: string; character?: string; motivation?: string; secret?: string; appearance?: string; mood?: string }[];
	location?: string;
	day?: number;
	time_of_day?: string;
	season?: string;
	current_moment?: string;
	recap?: string;
}

const SYSTEM = `Ты — парсер игровых документов настольной RPG. На вход даны 4 документа игрока
(лист персонажа, инвентарь, список NPC, описание текущей сессии). Извлеки СТРОГИЙ JSON
по схеме ниже. Отвечай ТОЛЬКО JSON-объектом, без пояснений и без markdown-ограждений.

Схема:
{
  "creation": { "name": string, "race": один из [${RACES.join(', ')}],
                "age_band": один из [${AGE_BANDS.join(', ')}],
                "direction": один из [${DIRECTIONS.join(', ')}], "darkPath": boolean },
  "capital_mp": число (всё богатство в медяках: 1 GP=100, 1 SP=10),
  "inventory": [ { "name": string, "qty": число, "slot": один из [${SLOTS.join(', ')}],
                   "magical": boolean, "charges"?: число, "notes"?: string } ],
  "npcs": [ { "name": string, "race"?: string, "age"?: число, "role"?: string, "estate"?: string,
              "character"?: string, "motivation"?: string, "secret"?: string, "appearance"?: string, "mood"?: string } ],
  "location": string, "day": число, "time_of_day": один из [${TIMES.join(', ')}],
  "season": один из [${SEASONS.join(', ')}],
  "current_moment": "2–4 предложения: где герой сейчас и что происходит",
  "recap": "краткий пересказ предыстории (до 6 предложений) для летописи"
}
Если данных нет — выбирай разумные значения по контексту. Имена/названия сохраняй как в документах.`;

function pick<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
	if (typeof val === 'string') {
		const v = val.trim().toLowerCase();
		const hit = allowed.find((a) => a.toLowerCase() === v);
		if (hit) return hit;
	}
	return fallback;
}

function extractJson(raw: string): ImportProfile {
	let s = raw.trim();
	// снять возможные ```json … ``` ограждения
	const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) s = fence[1]!.trim();
	const a = s.indexOf('{');
	const b = s.lastIndexOf('}');
	if (a === -1 || b === -1 || b < a) throw new Error('модель не вернула JSON');
	return JSON.parse(s.slice(a, b + 1)) as ImportProfile;
}

/** Импортировать партию из 4 документов → валидный GameState. */
export async function importGame(
	cfg: ServerConfig,
	docs: ImportDocs
): Promise<{ state: GameState; name: string; warnings: string[] }> {
	const warnings: string[] = [];
	const user = [
		`# Лист персонажа\n${docs.character || '(пусто)'}`,
		`# Инвентарь\n${docs.inventory || '(пусто)'}`,
		`# NPC\n${docs.npcs || '(пусто)'}`,
		`# Описание сессии\n${docs.session || '(пусто)'}`
	].join('\n\n');

	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM },
		{ role: 'user', content: user }
	];

	let p: ImportProfile | null = null;
	let lastErr = '';
	let lastRaw = '';
	for (let attempt = 0; attempt < 2 && !p; attempt++) {
		const msgs = attempt === 0
			? messages
			: [...messages, { role: 'user' as const, content: 'Верни ТОЛЬКО валидный JSON-объект по схеме. Без пояснений, без markdown.' }];
		const r = await completeDetailed(cfg, 'narrator', msgs, { temperature: 0.2, maxTokens: 2200 });
		const raw = r.text;
		lastRaw = raw;
		if (!raw.trim()) {
			lastErr = r.error
				? `модель Ведущего недоступна: ${r.error}. Укажите рабочий id модели в ⚙ Администрирование.`
				: 'модель Ведущего вернула пустой ответ (проверьте ключ OpenRouter и лимиты модели)';
			continue;
		}
		try {
			p = extractJson(raw);
		} catch (e) {
			lastErr = (e as Error).message;
		}
	}
	if (!p) {
		console.error('[import] не удалось разобрать ответ модели. Фрагмент:', lastRaw.slice(0, 400));
		throw new Error(lastErr || 'модель не вернула JSON');
	}

	// --- Создание персонажа (валидный базовый GameState) ---
	const choices: CreationChoices = {
		name: (p.creation?.name || 'Безымянный').toString().slice(0, 80),
		race: pick(p.creation?.race, RACES, 'человек'),
		age_band: pick(p.creation?.age_band, AGE_BANDS, 'зрелый'),
		direction: pick(p.creation?.direction, DIRECTIONS, 'путешественник'),
		...(p.creation?.darkPath ? { darkPath: true } : {})
	};
	const state = createCharacter(choices);
	const day = Number.isFinite(p.day) ? Math.max(1, Math.floor(p.day as number)) : state.session.day;

	// --- Дельты движком (валидируется транзакционно) ---
	const ops: Op[] = [];
	if (Number.isFinite(p.capital_mp)) {
		const target = Math.max(0, Math.floor(p.capital_mp as number));
		const delta = target - state.inventory.capital_mp;
		if (delta !== 0) ops.push({ op: 'capital.change', delta, reason: 'импорт' });
	}
	for (const it of p.inventory ?? []) {
		if (!it?.name) continue;
		ops.push({
			op: 'item.add',
			item: {
				name: String(it.name).slice(0, 120),
				qty: Number.isFinite(it.qty) ? Math.max(1, Math.floor(it.qty as number)) : 1,
				slot: pick(it.slot, SLOTS, 'сумка'),
				magical: Boolean(it.magical),
				...(Number.isFinite(it.charges) ? { charges: Math.floor(it.charges as number) } : {}),
				...(it.notes ? { notes: String(it.notes).slice(0, 200) } : {})
			}
		});
	}
	p.npcs?.forEach((n, i) => {
		if (!n?.name) return;
		ops.push({
			op: 'npc.spawn',
			seed_card: {
				id: `npc_${i}`,
				persistent: true,
				name: String(n.name).slice(0, 80),
				race: pick(n.race, RACES, 'человек'),
				...(Number.isFinite(n.age) ? { age: Math.floor(n.age as number) } : {}),
				...(n.role ? { role: String(n.role).slice(0, 80) } : {}),
				...(n.estate ? { estate: String(n.estate).slice(0, 60) } : {}),
				...(n.character ? { character: String(n.character).slice(0, 200) } : {}),
				...(n.motivation ? { motivation: String(n.motivation).slice(0, 200) } : {}),
				...(n.secret ? { secret: String(n.secret).slice(0, 200) } : {}),
				...(n.appearance ? { appearance: String(n.appearance).slice(0, 200) } : {}),
				...(n.mood ? { mood: String(n.mood).slice(0, 60) } : {})
			}
		});
	});

	if (ops.length) {
		const res = applyOps(state, ops, { day });
		Object.assign(state, res.state);
		for (const r of res.rejected) warnings.push(`операция отклонена: ${r.reason}`);
	}

	// --- Сессия и летопись ---
	state.session.day = day;
	state.session.time_of_day = pick(p.time_of_day, TIMES, state.session.time_of_day);
	state.session.season = pick(p.season, SEASONS, state.session.season);
	if (p.current_moment) state.session.current_moment = String(p.current_moment).slice(0, 1200);
	state.session.npcs_in_scene = state.npc.map((n) => n.id);

	const recap = (p.recap || '').toString().trim();
	const moment = state.session.current_moment;
	state.transcript = [
		{ speaker: 'system', text: `Партия импортирована из документов. Персонаж: ${choices.name}, ${choices.race}, ${choices.direction}.` },
		...(recap ? [{ speaker: 'master' as const, text: recap }] : []),
		...(moment ? [{ speaker: 'master' as const, text: `${moment}\n\nЧто ты делаешь?` }] : [])
	];

	return { state, name: choices.name, warnings };
}
