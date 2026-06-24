/**
 * Модель состояния (источник истины) — ТЗ §4, сборко-агностичная.
 * Структурный JSON; у схемы есть `schema_version` (ТЗ §15, миграции).
 *
 * Фаза 1 фокусируется на общем слое: core-персонаж, инвентарь/капитал.
 * Прочие коллекции заведены типами и наполняются в фазах 2–5.
 */

import type { PowerState, ReputationAxis, InventorySlot, FactScope } from './ops';
import type { RuleName } from './rules';
import type { CombatEncounter } from './encounter';

export const SCHEMA_VERSION = 1;

// --- Базовые перечисления из правил (rules-notes §4,5,10,11) ---

export type Attr = 'STR' | 'DEX' | 'CON' | 'INT' | 'PER' | 'CHA';
export type Race =
	| 'человек'
	| 'светлый эльф'
	| 'тёмный эльф'
	| 'гном'
	| 'полурослик'
	| 'орк'
	| 'полуэльф';
export type Direction =
	| 'военный'
	| 'наёмник'
	| 'ремесленник'
	| 'рабочий'
	| 'торговец'
	| 'путешественник'
	| 'преступник'
	| 'академик'
	| 'отшельник'
	| 'жрец';
export type ModuleName = 'magic' | 'combat_mastery' | 'intrigue' | 'faith' | 'craft' | 'influence';
export type MageType = 'черпающий' | 'своесильный';
export type MasteryLevel = 'Новичок' | 'Ученик' | 'Умелый' | 'Мастер' | 'Архимаг';
export type MagicSchool =
	| 'стихийная'
	| 'природная'
	| 'божественная'
	| 'аура'
	| 'иллюзии'
	| 'кровавая'
	| 'тёмная'
	| 'разума'
	| 'светлая';
export type DarkArc = 'Коррупция' | 'Деградация' | 'Распад памяти' | 'Годы жизни';
export type ReputationTier =
	| 'Легендарный'
	| 'Почитаемый'
	| 'Уважаемый'
	| 'Ценимый'
	| 'Нейтрален'
	| 'Подозрительный'
	| 'Нелюбимый'
	| 'Презираемый'
	| 'Ненавидимый'
	| 'Враг';

// --- Инвентарь и капитал (ТЗ §4.3, решает №5) ---

export interface InventoryItem {
	id: string;
	name: string;
	qty: number;
	charges?: number;
	slot: InventorySlot;
	magical: boolean;
	notes?: string;
	acquired_day: number;
}

export interface CapitalEntry {
	day: number;
	delta: number; // в медных монетах (MP)
	reason: string;
}

export interface Inventory {
	items: InventoryItem[];
	/** Капитал в медных монетах (MP). 1 GP = 10 SP = 100 MP. */
	capital_mp: number;
	/** Журнал последних операций капитала (хвост). */
	journal: CapitalEntry[];
}

// --- Статусы/ранения ---

export interface StatusEffect {
	effect: string;
	notes?: string;
	heals_by_day?: number;
}

// --- Модули способностей (ТЗ §4.2) ---

export interface MagicModule {
	power: PowerState;
	mage_type: MageType;
	schools: { school: MagicSchool; mastery: MasteryLevel }[];
	/** Тёмные дуги — описанием для игрока + скрытый прогресс у движка. */
	dark_arcs: { arc: DarkArc; note: string; hidden_progress: number }[];
}
export interface CombatModule {
	weapons: string[];
	features: string[];
	hidden_level: number;
}
export interface IntrigueModule {
	covers: string[];
	heat: number; // «след/подозрение», скрыто
	caches: string[];
}
export interface FaithModule {
	deity: string;
	domain: string;
	cult_status: string;
	faith: number; // вера/служение, скрыто
}
export interface CraftModule {
	craft: string;
	level: string;
	guild_status: string;
	recipes: string[];
}
export interface InfluenceModule {
	titles: string[];
	holdings: string[];
	court_status: string;
}

export interface Modules {
	magic?: MagicModule;
	combat_mastery?: CombatModule;
	intrigue?: IntrigueModule;
	faith?: FaithModule;
	craft?: CraftModule;
	influence?: InfluenceModule;
}

// --- Общий слой персонажа (ТЗ §4.1) ---

export interface CharacterCore {
	name: string;
	true_name?: string;
	race: Race;
	age: number;
	directions: Direction[];
	/** Скрытые атрибуты — движок, игроку не показываются. */
	attrs: Record<Attr, number>;
	hp: { cur: number; max: number };
	stamina: { cur: number; max: number };
	statuses: StatusEffect[];
	/** Особенности словами (ТЗ §4.1, прогрессия слой 2). */
	features: string[];
	specializations: string[];
	reputation: { faction: string; tier: ReputationTier; hidden: Record<ReputationAxis, number> }[];
	renown: number; // «известность», скрыто
	updated_day: number;
}

// --- Прочие сущности (ТЗ §4.4) — типы; наполнение в фазах 2–5 ---

export interface Fact {
	id: string;
	text: string;
	scope: FactScope;
	known_by: string[];
	tags: string[];
	created_day: number;
}
/**
 * Запертое ядро NPC (ТЗ §4.6, решает №4): immutable-by-default. Меняется
 * только операцией npc.alter_core с причиной. Модель не «вспоминает» личность —
 * движок отдаёт ядро дословно каждый ход, дрейф невозможен.
 */
export interface NpcCore {
	name: string;
	race: Race;
	age: number;
	estate: string; // сословие
	role: string;
	speech_register: string; // речевой регистр
	character: string; // ядро характера
	motivation: string;
	secret: string;
	appearance: string;
}

/** Живой слой NPC (mutable): меняется свободно по ходу. */
export interface NpcLiving {
	mood: string;
	location_id?: string;
	last_interactions: string[];
	last_seen_day?: number;
}

export interface Npc {
	id: string;
	/** Персистить (значимый) или эфемерный в рамках сцены (ТЗ §9.9). */
	persistent: boolean;
	core: NpcCore;
	living: NpcLiving;
	/** Лог изменений ядра (каждое — с причиной, ТЗ §4.6). */
	core_changes?: { day: number; cause: string; fields: string[] }[];
}
export interface Relationship {
	from: string;
	to: string;
	axis: ReputationAxis;
	level: number;
	notes?: string;
}
export interface Contract {
	id: string;
	title: string;
	giver_npc?: string;
	status: 'предложен' | 'активен' | 'выполнен' | 'провален' | 'отказ';
	objectives: string[];
	reward?: string;
	deadline_day?: number;
	faction?: string;
	notes?: string;
}
export interface GameLocation {
	id: string;
	name: string;
	region: string;
	type: string;
	properties?: string[];
	known_npcs?: string[];
	notes?: string;
}
export interface Timer {
	id: string;
	label: string;
	due_day: number;
	type: string;
	payload?: Record<string, unknown>;
}
export interface ChronicleRecord {
	day: number;
	location?: string;
	event: string;
	applied_ops: string[];
}
export interface Seed {
	id: string;
	description: string;
	trigger: { type: 'time' | 'location' | 'faction_threshold' | 'random' | 'flag'; params: Record<string, unknown> };
	payload: Record<string, unknown>;
	tags: string[];
	planted_day: number;
}
export interface Arc {
	id: string;
	tags: string[];
	motifs_used: string[];
}

/** Состояние мира для мир-симуляции (ТЗ §4.4, §12). */
export interface FactionState {
	name: string;
	/** Сила/влияние (грубо). */
	power: number;
	mood: string;
}
export interface RegionState {
	name: string;
	notes: string;
}
export interface WorldState {
	/** Мировые часы — день последнего тика симуляции. */
	clock_day: number;
	factions: FactionState[];
	regions: RegionState[];
}

export interface SessionState {
	day: number;
	time_of_day: 'утро' | 'день' | 'вечер' | 'ночь';
	season: 'зима' | 'весна' | 'лето' | 'осень';
	weather?: string;
	location_id?: string;
	current_moment: string;
	npcs_in_scene: string[];
	open_threads: string[];
}

/** Полное игровое состояние (канон). */
export interface GameState {
	schema_version: number;
	character: { core: CharacterCore; modules: Modules };
	inventory: Inventory;
	facts: Fact[];
	npc: Npc[];
	relationships: Relationship[];
	contracts: Contract[];
	locations: GameLocation[];
	timers: Timer[];
	chronicle: ChronicleRecord[];
	seeds: Seed[];
	arcs: Arc[];
	world_state?: WorldState;
	/** Активная боевая стычка (ТЗ §9.2), если идёт бой. */
	combat?: CombatEncounter;
	/** Скрытые счётчики практики (слой 1 прогрессии). */
	progress?: ProgressState;
	session: SessionState;
	/** Какие версии правил действовали (для воспроизводимости; ТЗ §13). */
	rules_versions?: Partial<Record<RuleName, string>>;
}

/** Слой 1 прогрессии (ТЗ §9.11): скрытые счётчики практики + выданные особенности. */
export interface ProgressState {
	counters: Record<string, number>;
	granted: string[];
}

/** Активные модули персонажа (для гейтинга операций и адаптивного UI). */
export function activeModules(state: GameState): ModuleName[] {
	return Object.keys(state.character.modules) as ModuleName[];
}
