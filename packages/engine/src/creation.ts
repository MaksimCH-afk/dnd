/**
 * Создание персонажа (ТЗ §5, creation.md) — детерминированный флоу.
 * Все броски скрытые, через сид (rng). Потолок старта: способный, не прокачанный.
 *
 * РЕШАЕТ R1 (сборко-агностичность): модули включаются по направлению + проверке
 * таланта к магии. Нет таланта → магии нет, это валидная полноценная сборка.
 */

import { makeRng, seedFromString, type Rng } from './rng';
import { defaultWorldState } from './worldsim';
import type { ReputationAxis } from './ops';
import {
	SCHEMA_VERSION,
	type Attr,
	type CharacterCore,
	type Direction,
	type GameState,
	type InventoryItem,
	type MagicSchool,
	type Modules,
	type Race
} from './state';

export type AgeBand = 'молодой' | 'зрелый' | 'пожилой';

/** Рантайм-списки для UI создания. */
export const RACES: Race[] = ['человек', 'светлый эльф', 'тёмный эльф', 'гном', 'полурослик', 'орк', 'полуэльф'];
export const AGE_BANDS: AgeBand[] = ['молодой', 'зрелый', 'пожилой'];
export const DIRECTIONS: Direction[] = [
	'военный',
	'наёмник',
	'ремесленник',
	'рабочий',
	'торговец',
	'путешественник',
	'преступник',
	'академик',
	'отшельник',
	'жрец'
];
/** Направления, где осознанно доступна тёмная дорожка магии. */
export const DARK_PATH_DIRECTIONS: Direction[] = ['академик', 'отшельник'];

export interface CreationChoices {
	name: string;
	race: Race;
	age_band: AgeBand;
	direction: Direction;
	/** Осознанный выбор тёмной дорожки (только для магически способных). */
	darkPath?: boolean;
	/** Сид для воспроизводимости (по умолчанию — из имени). */
	seed?: number;
}

const ALL_ATTRS: Attr[] = ['STR', 'DEX', 'CON', 'INT', 'PER', 'CHA'];

const DIRECTION_PRIMARY: Record<Direction, Attr[]> = {
	военный: ['STR', 'CON'],
	наёмник: ['STR', 'DEX'],
	ремесленник: ['INT', 'STR'],
	рабочий: ['CON', 'STR'],
	торговец: ['CHA', 'INT'],
	путешественник: ['CON', 'PER'],
	преступник: ['DEX', 'PER'],
	академик: ['INT', 'PER'],
	отшельник: ['PER', 'CON'],
	жрец: ['CHA', 'INT']
};

const RACE_MODS: Record<Race, Partial<Record<Attr, number>>> = {
	человек: {},
	'светлый эльф': { INT: 2, DEX: 1, CON: -2 },
	'тёмный эльф': { DEX: 2, PER: 1, CHA: -1 },
	гном: { CON: 2, STR: 1, DEX: -1 },
	полурослик: { DEX: 2, PER: 1, STR: -2 },
	орк: { STR: 3, CON: 1, INT: -2 },
	полуэльф: { CHA: 1, INT: 1 }
};

const AGE_MODS: Record<AgeBand, Partial<Record<Attr, number>>> = {
	молодой: { STR: 1, CON: 1, INT: -1 },
	зрелый: {},
	пожилой: { STR: -1, CON: -1, INT: 1, CHA: 1 }
};

const AGE_YEARS: Record<Race, Record<AgeBand, number>> = {
	человек: { молодой: 20, зрелый: 38, пожилой: 65 },
	'светлый эльф': { молодой: 90, зрелый: 250, пожилой: 430 },
	'тёмный эльф': { молодой: 70, зрелый: 200, пожилой: 350 },
	гном: { молодой: 45, зрелый: 130, пожилой: 220 },
	полурослик: { молодой: 28, зрелый: 60, пожилой: 100 },
	орк: { молодой: 18, зрелый: 35, пожилой: 52 },
	полуэльф: { молодой: 30, зрелый: 90, пожилой: 150 }
};

/** Направления, у которых возможен старт с магией (через проверку таланта). */
const MAGIC_CAPABLE: Partial<Record<Direction, { chance: number; school: MagicSchool }>> = {
	академик: { chance: 0.85, school: 'стихийная' },
	жрец: { chance: 0.8, school: 'божественная' },
	отшельник: { chance: 0.45, school: 'природная' }
};

const COMBAT_DIRECTIONS: Direction[] = ['военный', 'наёмник'];
const HP_BONUS: Partial<Record<Direction, number>> = { военный: 8, наёмник: 5, рабочий: 4, путешественник: 3 };

// Стартовый капитал (диапазон в MP; 1 SP=10 MP) — малый, по systems.md.
const CAPITAL_MP: Record<Direction, [number, number]> = {
	военный: [300, 600],
	наёмник: [400, 800],
	ремесленник: [800, 1800],
	рабочий: [150, 400],
	торговец: [2000, 6000],
	путешественник: [300, 700],
	преступник: [200, 700],
	академик: [500, 1200],
	отшельник: [100, 350],
	жрец: [200, 500]
};

const START_LOCATION: Record<Direction, { name: string; region: string; type: string }> = {
	военный: { name: 'Гарнизонная застава', region: 'Центральные земли', type: 'крепость' },
	наёмник: { name: 'Таверна «Треснувший щит»', region: 'Центральные земли', type: 'таверна' },
	ремесленник: { name: 'Ремесленный квартал', region: 'Центральные земли', type: 'мастерская' },
	рабочий: { name: 'Окраина города', region: 'Центральные земли', type: 'трущобы' },
	торговец: { name: 'Торговый ряд', region: 'Центральные земли', type: 'рынок' },
	путешественник: { name: 'Постоялый двор у тракта', region: 'Центральные земли', type: 'постоялый двор' },
	преступник: { name: 'Притон в Нижнем городе', region: 'Центральные земли', type: 'притон' },
	академик: { name: 'Академия Серебряной Луны', region: 'Центральные земли', type: 'академия' },
	отшельник: { name: 'Хижина на опушке', region: 'Глушь', type: 'хижина' },
	жрец: { name: 'Храм Солнца', region: 'Центральные земли', type: 'храм' }
};

const START_FEATURE: Partial<Record<Direction, string>> = {
	военный: 'Дисциплина строя',
	наёмник: 'Привычен к дороге',
	ремесленник: 'Намётанный глаз на материал',
	рабочий: 'Двужильный',
	торговец: 'Чует выгоду',
	путешественник: 'Привычен к дороге',
	преступник: 'Тихий шаг',
	академик: 'Начитан',
	отшельник: 'Привычен к одиночеству',
	жрец: 'Слово утешения'
};

function startEquipment(dir: Direction, day: number): InventoryItem[] {
	const it = (name: string, slot: InventoryItem['slot'] = 'сумка', extra: Partial<InventoryItem> = {}): InventoryItem => ({
		id: `it_${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24)}_${day}_${Math.abs(hashName(name)) % 1000}`,
		name,
		qty: 1,
		slot,
		magical: false,
		acquired_day: day,
		...extra
	});
	const ration = it('Дорожный паёк (неделя)');
	switch (dir) {
		case 'военный':
			return [it('Длинный меч', 'надето'), it('Кольчуга', 'надето'), it('Щит', 'надето'), ration];
		case 'наёмник':
			return [it('Короткий меч', 'надето'), it('Кинжал', 'надето'), it('Кожаный доспех', 'надето'), ration];
		case 'преступник':
			return [it('Кинжал', 'надето'), it('Отмычки'), it('Тёмный плащ', 'надето'), ration];
		case 'академик':
			return [it('Посох', 'надето'), it('Книга записей'), it('Чернильница'), ration];
		case 'жрец':
			return [it('Символ Солнца', 'надето'), it('Облачение', 'надето'), it('Священное масло'), ration];
		case 'ремесленник':
			return [it('Набор инструментов'), it('Фартук', 'надето'), ration];
		case 'торговец':
			return [it('Весы'), it('Гроссбух'), it('Добротная одежда', 'надето'), ration];
		case 'путешественник':
			return [it('Дорожный посох', 'надето'), it('Спальник'), it('Кинжал', 'надето'), ration];
		case 'отшельник':
			return [it('Нож', 'надето'), it('Котелок'), it('Травяной сбор'), ration];
		default:
			return [it('Нож', 'надето'), ration];
	}
}

function hashName(s: string): number {
	return seedFromString(s) | 0;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

function rollAttrs(choices: CreationChoices, rng: Rng): Record<Attr, number> {
	const attrs = {} as Record<Attr, number>;
	const primary = new Set(DIRECTION_PRIMARY[choices.direction]);
	const raceMod = RACE_MODS[choices.race];
	const ageMod = AGE_MODS[choices.age_band];
	for (const a of ALL_ATTRS) {
		let v = 10;
		if (primary.has(a)) v += 2;
		v += raceMod[a] ?? 0;
		v += ageMod[a] ?? 0;
		v += rng.int(-1, 1); // скрытый бросок
		attrs[a] = clamp(v, 6, 18);
	}
	return attrs;
}

function buildModules(choices: CreationChoices, attrs: Record<Attr, number>, rng: Rng): Modules {
	const mods: Modules = {};
	const dir = choices.direction;

	// Боевой модуль.
	if (COMBAT_DIRECTIONS.includes(dir)) {
		mods.combat_mastery = { weapons: dir === 'военный' ? ['длинный меч', 'щит'] : ['короткий меч', 'кинжал'], features: [], hidden_level: 1 };
	} else if (dir === 'преступник') {
		mods.combat_mastery = { weapons: ['кинжал'], features: [], hidden_level: 1 }; // лёгкий
	}

	// Интрига.
	if (dir === 'преступник') {
		mods.intrigue = { covers: [], heat: 0, caches: [] };
	}

	// Ремесло / влияние.
	if (dir === 'ремесленник') {
		mods.craft = { craft: 'кузнечное дело', level: 'подмастерье', guild_status: 'не в гильдии', recipes: [] };
	}
	if (dir === 'торговец') {
		mods.influence = { titles: [], holdings: [], court_status: 'мелкий купец' };
	}

	// Магия — по проверке таланта (скрыто).
	const magicCfg = MAGIC_CAPABLE[dir];
	if (magicCfg) {
		const talented = rng.chance(magicCfg.chance + (attrs.INT - 10) * 0.02);
		if (talented) {
			const dark = choices.darkPath === true;
			const school: MagicSchool = dark ? (rng.chance(0.5) ? 'кровавая' : 'тёмная') : magicCfg.school;
			mods.magic = {
				power: 'Полон',
				mage_type: dark ? 'своесильный' : 'черпающий',
				schools: [{ school, mastery: 'Новичок' }],
				dark_arcs: dark
					? [{ arc: school === 'кровавая' ? 'Коррупция' : 'Деградация', note: 'тень нависает с самого начала', hidden_progress: 0 }]
					: []
			};
		}
	}

	// Вера (жрец) — даже без магического таланта остаётся служение.
	if (dir === 'жрец') {
		mods.faith = { deity: 'Солнце', domain: 'свет/жизнь/исцеление/порядок', cult_status: 'послушник', faith: 1 };
	}

	return mods;
}

function emptyAxes(): Record<ReputationAxis, number> {
	return { доверие: 0, страх: 0, долг: 0, вражда: 0, романтика: 0 };
}

/** Создаёт стартовое состояние игры по выбору игрока (детерминированно по сиду). */
export function createCharacter(choices: CreationChoices): GameState {
	const seed = choices.seed ?? seedFromString(`${choices.name}|${choices.race}|${choices.direction}`);
	const rng = makeRng(seed);
	const day = 1;

	const attrs = rollAttrs(choices, rng);
	const hpMax = attrs.CON * (5 + rng.int(0, 2)) + (HP_BONUS[choices.direction] ?? 0);
	const staMax = attrs.CON * 10;
	const modules = buildModules(choices, attrs, rng);

	// Стартовая репутация: тёмная сборка → подозрительный, иначе нейтрально.
	const dark = Boolean(modules.magic?.dark_arcs.length) || choices.darkPath === true;
	const baseTier = dark ? 'Подозрительный' : 'Нейтрален';

	const capitalRange = CAPITAL_MP[choices.direction];
	const capital = rng.int(capitalRange[0], capitalRange[1]);

	const loc = START_LOCATION[choices.direction];
	const feature = START_FEATURE[choices.direction];

	const core: CharacterCore = {
		name: choices.name,
		race: choices.race,
		age: AGE_YEARS[choices.race][choices.age_band],
		directions: [choices.direction],
		attrs,
		hp: { cur: hpMax, max: hpMax },
		stamina: { cur: staMax, max: staMax },
		statuses: [],
		features: feature ? [feature] : [],
		specializations: [],
		reputation: [
			{ faction: 'простолюдины', tier: baseTier, hidden: emptyAxes() },
			...(dark ? [{ faction: 'Церковь Солнца', tier: 'Подозрительный' as const, hidden: emptyAxes() }] : [])
		],
		renown: 0,
		updated_day: day
	};

	const equipment = startEquipment(choices.direction, day);

	const state: GameState = {
		schema_version: SCHEMA_VERSION,
		character: { core, modules },
		inventory: {
			items: equipment,
			capital_mp: capital,
			journal: [{ day, delta: capital, reason: 'стартовый капитал' }]
		},
		facts: [],
		npc: [],
		relationships: [],
		contracts: [],
		locations: [{ id: 'loc_start', name: loc.name, region: loc.region, type: loc.type }],
		timers: [],
		chronicle: [],
		seeds: [],
		arcs: [],
		world_state: defaultWorldState(day),
		progress: { counters: {}, granted: [] },
		session: {
			day,
			time_of_day: 'утро',
			season: 'весна',
			weather: 'свежее утро',
			location_id: 'loc_start',
			current_moment: `${loc.name}, ${loc.region}. Здесь начинается твой путь.`,
			npcs_in_scene: [],
			open_threads: []
		}
	};
	return state;
}
