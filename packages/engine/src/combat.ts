/**
 * Бой — детерминированный резолвер (ТЗ §9.2, systems.md ч.I). Непрерывное время,
 * скрытые броски движка. LLM не решает успех — получает исход (R2).
 *
 * Игрок цифр и DC не видит; раскрытие — только через /ask.
 */

import type { Rng } from './rng';

export type CombatStyle = 'агрессивный' | 'обычный' | 'оборонительный' | 'только защита' | 'безрассудный';

/** Модификаторы стилей (systems.md «Динамический AC по стилю»). */
export const STYLE_MODS: Record<CombatStyle, { ac: number; atk: number }> = {
	агрессивный: { ac: -2, atk: 2 },
	обычный: { ac: 0, atk: 0 },
	оборонительный: { ac: 2, atk: -2 },
	'только защита': { ac: 5, atk: -5 },
	безрассудный: { ac: -5, atk: 5 }
};

/** Кости урона по оружию (systems.md). [кол-во, грани, бонус]. */
export const WEAPON_DAMAGE: Record<string, [number, number]> = {
	кулак: [1, 2],
	кинжал: [1, 4],
	'короткий меч': [1, 6],
	'длинный меч': [1, 8],
	двуручный: [2, 6],
	топор: [1, 8],
	копьё: [1, 8],
	лук: [1, 8],
	арбалет: [1, 10]
};

/** Скорость действий в секундах (скрыто; «кто раньше»). */
export const ACTION_SPEED: Record<string, [number, number]> = {
	кинжал: [1, 2],
	'короткий меч': [2, 3],
	'длинный меч': [2, 3],
	двуручный: [4, 5],
	лук: [3, 4],
	арбалет: [6, 8],
	'парирование/уклонение': [1, 2],
	'смена оружия': [3, 5],
	'сближение 5м': [2, 3]
};

/** Атрибут как модификатор броска (интерпретация движка: attr − 10). */
export function attrMod(attr: number): number {
	return attr - 10;
}

export type WoundStage = 'нет' | 'лёгкая' | 'средняя' | 'тяжёлая' | 'критическая' | 'смерть';

/** Степень ранения по доле потерянных HP (systems.md). */
export function woundStage(cur: number, max: number): WoundStage {
	if (cur <= 0) return 'смерть';
	const lost = (max - cur) / max;
	if (lost <= 0) return 'нет';
	if (lost <= 0.25) return 'лёгкая';
	if (lost <= 0.5) return 'средняя';
	if (lost <= 0.75) return 'тяжёлая';
	return 'критическая';
}

/** Штраф ко всем действиям от ранения. */
export function woundPenalty(stage: WoundStage): number {
	switch (stage) {
		case 'средняя':
			return -2;
		case 'тяжёлая':
			return -5;
		case 'критическая':
			return -10;
		default:
			return 0;
	}
}

export type StaminaState = 'бодр' | 'устал' | 'сильно устал' | 'изнеможение' | 'упал';

export function staminaState(cur: number, max: number): StaminaState {
	const r = max ? cur / max : 0;
	if (r >= 0.6) return 'бодр';
	if (r >= 0.4) return 'устал';
	if (r >= 0.2) return 'сильно устал';
	if (r > 0) return 'изнеможение';
	return 'упал';
}

export interface AttackInput {
	/** Модификатор атаки: attrMod(STR|DEX) + качество оружия и т.п. */
	attackBonus: number;
	style: CombatStyle;
	/** AC цели (см. computeAC). */
	targetAC: number;
	/** Ситуационные модификаторы (сзади +5, в темноте −5, …). */
	situational?: number;
}

export interface AttackResult {
	roll: number;
	total: number;
	hit: boolean;
	crit: boolean;
	fumble: boolean;
}

/** AC цели: 10 + DEX-мод + броня + щит + стиль + ситуация. */
export function computeAC(opts: {
	dex: number;
	armor?: number;
	shield?: number;
	style: CombatStyle;
	situational?: number;
}): number {
	return (
		10 +
		attrMod(opts.dex) +
		(opts.armor ?? 0) +
		(opts.shield ?? 0) +
		STYLE_MODS[opts.style].ac +
		(opts.situational ?? 0)
	);
}

/** Скрытый бросок атаки (R2). Крит на нат.20, провал на нат.1. */
export function resolveAttack(input: AttackInput, rng: Rng): AttackResult {
	const roll = rng.d20();
	const total = roll + input.attackBonus + STYLE_MODS[input.style].atk + (input.situational ?? 0);
	if (roll === 1) return { roll, total, hit: false, crit: false, fumble: true };
	if (roll === 20) return { roll, total, hit: true, crit: true, fumble: false };
	return { roll, total, hit: total >= input.targetAC, crit: false, fumble: false };
}

/** Бросок урона по оружию (+ модификатор; крит удваивает кости). */
export function rollDamage(weapon: string, rng: Rng, opts: { bonus?: number; crit?: boolean } = {}): number {
	const dmg = WEAPON_DAMAGE[weapon] ?? WEAPON_DAMAGE['кулак']!;
	const dice = (opts.crit ? 2 : 1) * dmg[0];
	let sum = 0;
	for (let i = 0; i < dice; i++) sum += rng.int(1, dmg[1]);
	return Math.max(1, sum + (opts.bonus ?? 0));
}

/** Проверка концентрации при касте под уроном: DC = max(10, урон/2). */
export function concentrationDC(damage: number): number {
	return Math.max(10, Math.floor(damage / 2));
}

export function concentrationHolds(damage: number, casterBonus: number, rng: Rng): boolean {
	return rng.d20() + casterBonus >= concentrationDC(damage);
}
