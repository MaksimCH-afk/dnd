/**
 * Контракт операций (tool-calls) — ТЗ раздел 8.1.
 *
 * Нарратор ПРЕДЛАГАЕТ изменения как `Op[]`. Валидатор (LLM) нормализует формат.
 * Движок применяет ТОЛЬКО провалидированные `Op`; модуль-зависимые операции
 * отклоняются, если соответствующий модуль персонажа не активен (ТЗ 7.3).
 *
 * Это типы намерений; детерминированные значения (цены, кости, урон) считает
 * движок, а не приходят из модели.
 */

export type ReputationAxis = 'доверие' | 'страх' | 'долг' | 'вражда' | 'романтика';

export type InventorySlot = 'надето' | 'сумка' | 'схрон';

export interface ItemInput {
	name: string;
	qty: number;
	charges?: number;
	slot?: InventorySlot;
	magical?: boolean;
	notes?: string;
}

export type FactScope = 'public' | 'player' | 'secret' | `npc:${string}`;

/** Состояние Силы (enum, грубо/скрыто) — модуль magic. */
export type PowerState = 'Полон' | 'Расходует' | 'На исходе' | 'Истощён';

// --- Общие операции (доступны любой сборке) ---

export interface CapitalChangeOp {
	op: 'capital.change';
	delta: number;
	reason: string;
}
export interface ItemAddOp {
	op: 'item.add';
	item: ItemInput;
}
export interface ItemRemoveOp {
	op: 'item.remove';
	id: string;
	qty: number;
	reason: string;
}
export interface ItemUpdateOp {
	op: 'item.update';
	id: string;
	fields: Partial<ItemInput>;
}
export interface HpChangeOp {
	op: 'hp.change';
	delta: number;
	reason: string;
}
export interface StaminaChangeOp {
	op: 'stamina.change';
	delta: number;
	reason: string;
}
export interface StatusAddOp {
	op: 'status.add';
	effect: string;
	notes?: string;
}
export interface StatusRemoveOp {
	op: 'status.remove';
	effect: string;
}
export interface ReputationShiftOp {
	op: 'reputation.shift';
	faction: string;
	axis: ReputationAxis;
	delta: number;
	reason: string;
}
export interface FactAddOp {
	op: 'fact.add';
	text: string;
	scope: FactScope;
	known_by: string[];
	tags: string[];
}
export interface NpcRelationshipOp {
	op: 'npc.relationship';
	from: string;
	to: string;
	axis: ReputationAxis;
	delta: number;
	notes?: string;
}
export interface NpcSpawnOp {
	op: 'npc.spawn';
	seed_card: Record<string, unknown>;
}
export interface NpcAlterCoreOp {
	op: 'npc.alter_core';
	id: string;
	fields: Record<string, unknown>;
	cause: string; // обязательна (ТЗ 4.6/7.3)
}
export interface ContractOfferOp {
	op: 'contract.offer';
	fields: Record<string, unknown>;
}
export interface ContractUpdateOp {
	op: 'contract.update';
	id: string;
	fields: Record<string, unknown>;
}
export interface ContractCloseOp {
	op: 'contract.close';
	id: string;
	status: 'выполнен' | 'провален' | 'отказ';
}
export interface LocationNoteOp {
	op: 'location.note';
	id: string;
	fields: Record<string, unknown>;
}
export interface TimerAddOp {
	op: 'timer.add';
	label: string;
	due_day: number;
	type: string;
	payload?: Record<string, unknown>;
}
export interface TimerFireOp {
	op: 'timer.fire';
	id: string;
}
export interface TimeAdvanceOp {
	op: 'time.advance';
	/** Вес действия во времени (грубо): мгновение|минуты|часы|полдня|день|дни|сон. */
	scale: 'мгновение' | 'минуты' | 'часы' | 'полдня' | 'день' | 'дни' | 'сон';
	/** Для крупных переходов (дорога/ожидание): сколько дней. */
	days?: number;
}
export interface CombatStartOp {
	op: 'combat.start';
	enemies: { name: string; tier?: 'слабый' | 'обычный' | 'опытный' | 'монстр'; weapon?: string }[];
}
export interface CombatEndOp {
	op: 'combat.end';
}
export interface SeedPlantOp {
	op: 'seed.plant';
	description: string;
	trigger: { type: 'time' | 'location' | 'faction_threshold' | 'random' | 'flag'; params: Record<string, unknown> };
	payload?: Record<string, unknown>;
	tags: string[];
}
export interface FeatureGrantOp {
	op: 'feature.grant';
	name: string;
	description: string;
}
export interface ProgressTickOp {
	op: 'progress.tick';
	activity: string;
	n?: number;
}
export interface SpecializationOfferOp {
	op: 'specialization.offer';
	options: string[];
}
export interface SpecializationSelectOp {
	op: 'specialization.select';
	choice: string;
}

// --- Модуль-зависимые операции (отклоняются без активного модуля) ---

export interface PowerSetOp {
	op: 'power.set'; // только если активен magic
	state: PowerState;
}
export interface DarkcostAdvanceOp {
	op: 'darkcost.advance'; // только переступающее (порог)
	arc: string;
	reason: string;
}
export interface HeatChangeOp {
	op: 'heat.change'; // только если активен intrigue
	delta: number;
	reason: string;
}
export interface FaithShiftOp {
	op: 'faith.shift'; // только если активен faith
	delta: number;
	reason: string;
}
export interface CraftProgressOp {
	op: 'craft.progress'; // только если активен craft
	fields: Record<string, unknown>;
}

export type Op =
	| CapitalChangeOp
	| ItemAddOp
	| ItemRemoveOp
	| ItemUpdateOp
	| HpChangeOp
	| StaminaChangeOp
	| StatusAddOp
	| StatusRemoveOp
	| ReputationShiftOp
	| FactAddOp
	| NpcRelationshipOp
	| NpcSpawnOp
	| NpcAlterCoreOp
	| ContractOfferOp
	| ContractUpdateOp
	| ContractCloseOp
	| LocationNoteOp
	| TimerAddOp
	| TimerFireOp
	| TimeAdvanceOp
	| CombatStartOp
	| CombatEndOp
	| SeedPlantOp
	| FeatureGrantOp
	| ProgressTickOp
	| SpecializationOfferOp
	| SpecializationSelectOp
	| PowerSetOp
	| DarkcostAdvanceOp
	| HeatChangeOp
	| FaithShiftOp
	| CraftProgressOp;

export type OpName = Op['op'];

/** Какому модулю принадлежит операция (если модуль-зависимая). */
export const OP_MODULE_REQUIREMENT: Partial<Record<OpName, string>> = {
	'power.set': 'magic',
	'darkcost.advance': 'magic',
	'heat.change': 'intrigue',
	'faith.shift': 'faith',
	'craft.progress': 'craft'
};
