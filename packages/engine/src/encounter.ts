/**
 * Боевой цикл (ТЗ §9.2, systems.md): непрерывное время, одновременность.
 * Движок скрыто решает «кто успел раньше» и возвращает ИСХОДЫ (не тайминги) —
 * нарратор их описывает, не объявляя секунды и не спрашивая «продолжаешь?».
 * Игрок цифр и DC не видит (R2). Раскрытие — через /ask (лог).
 */

import type { Rng } from './rng';
import {
	attrMod,
	computeAC,
	resolveAttack,
	rollDamage,
	woundStage,
	ACTION_SPEED,
	type CombatStyle
} from './combat';
import type { Attr, GameState } from './state';

export type EnemyTier = 'слабый' | 'обычный' | 'опытный' | 'монстр';

const TIER_HP: Record<EnemyTier, [number, number]> = {
	слабый: [5, 15],
	обычный: [30, 50],
	опытный: [60, 80],
	монстр: [50, 200]
};
const TIER_ATK: Record<EnemyTier, number> = { слабый: 1, обычный: 3, опытный: 5, монстр: 7 };
const TIER_AC: Record<EnemyTier, number> = { слабый: 11, обычный: 13, опытный: 15, монстр: 16 };

export interface Enemy {
	id: string;
	name: string;
	tier: EnemyTier;
	hp_cur: number;
	hp_max: number;
	weapon: string;
	ac: number;
	attack_bonus: number;
	speed_s: number;
	fled: boolean;
}

export interface CombatEncounter {
	enemies: Enemy[];
	round: number;
}

export interface EnemySpec {
	name: string;
	tier?: EnemyTier;
	weapon?: string;
}

/** Создать стычку из спецификаций (HP — скрытый бросок в диапазоне тира). */
export function startEncounter(specs: EnemySpec[], rng: Rng): CombatEncounter {
	const enemies: Enemy[] = specs.map((s, i) => {
		const tier = s.tier ?? 'обычный';
		const [lo, hi] = TIER_HP[tier];
		const hp = rng.int(lo, hi);
		const weapon = s.weapon ?? 'короткий меч';
		return {
			id: `e${i}`,
			name: s.name,
			tier,
			hp_cur: hp,
			hp_max: hp,
			weapon,
			ac: TIER_AC[tier],
			attack_bonus: TIER_ATK[tier],
			speed_s: (ACTION_SPEED[weapon]?.[0] ?? 2) + 1,
			fled: false
		};
	});
	return { enemies, round: 0 };
}

/** Оценка бонуса брони героя по надетым предметам (имя → бонус). */
export function heroArmor(state: GameState): { armor: number; shield: number } {
	let armor = 0;
	let shield = 0;
	for (const it of state.inventory.items) {
		if (it.slot !== 'надето') continue;
		const n = it.name.toLowerCase();
		if (n.includes('латы')) armor = Math.max(armor, 6);
		else if (n.includes('кольчуг')) armor = Math.max(armor, 4);
		else if (n.includes('кож')) armor = Math.max(armor, 2);
		if (n.includes('щит')) shield = 2;
	}
	return { armor, shield };
}

function heroWeapon(state: GameState): string {
	const cm = state.character.modules.combat_mastery;
	const equipped = state.inventory.items.find((i) => i.slot === 'надето' && /меч|кинжал|топор|копь|лук|арбалет|посох/.test(i.name.toLowerCase()));
	return equipped?.name?.toLowerCase().split(' ')[0] ?? cm?.weapons[0] ?? 'кулак';
}

export interface ExchangeOpts {
	style: CombatStyle;
	targetId?: string;
	flee?: boolean;
	situational?: number;
}

export interface ExchangeResult {
	encounter: CombatEncounter;
	heroHpDelta: number;
	staminaDelta: number;
	/** Повествовательные подсказки исхода (без таймингов/чисел DC). */
	cues: string[];
	ended: boolean;
	victory: boolean;
	heroDown: boolean;
}

/**
 * Один обмен в непрерывном бою. Герой действует по намерению (стиль/цель/бегство);
 * живые враги отвечают. Скорости решают, кто раньше (для повествования).
 */
export function resolveExchange(prev: GameState, enc: CombatEncounter, opts: ExchangeOpts, rng: Rng): ExchangeResult {
	const encounter: CombatEncounter = structuredClone(enc);
	encounter.round += 1;
	const cues: string[] = [];
	let heroHpDelta = 0;
	let staminaDelta = -2;

	const core = prev.character.core;
	const weapon = heroWeapon(prev);
	const wpnAttr: Attr = /кинжал|лук|арбалет/.test(weapon) ? 'DEX' : 'STR';
	const heroAtk = attrMod(core.attrs[wpnAttr]);
	const heroSpeed = ACTION_SPEED[weapon]?.[0] ?? 2;
	const { armor, shield } = heroArmor(prev);
	const heroAC = computeAC({ dex: core.attrs.DEX, armor, shield, style: opts.style, ...(opts.situational != null ? { situational: opts.situational } : {}) });

	const living = () => encounter.enemies.filter((e) => e.hp_cur > 0 && !e.fled);

	// Бегство: шанс зависит от скорости/числа врагов.
	if (opts.flee) {
		const ok = rng.chance(0.5 - Math.min(0.3, living().length * 0.1));
		staminaDelta -= 8;
		if (ok) {
			cues.push('Ты успеваешь разорвать дистанцию и уйти от схватки.');
			return { encounter, heroHpDelta, staminaDelta, cues, ended: true, victory: false, heroDown: false };
		}
		cues.push('Оторваться не удаётся — враг насел.');
	}

	// Удар героя по цели (если не чистое бегство-провал).
	const target = encounter.enemies.find((e) => e.id === opts.targetId && e.hp_cur > 0) ?? living()[0];
	if (target && !opts.flee) {
		const atk = resolveAttack({ attackBonus: heroAtk, style: opts.style, targetAC: target.ac, ...(opts.situational != null ? { situational: opts.situational } : {}) }, rng);
		staminaDelta -= 3;
		if (atk.hit) {
			const dmg = rollDamage(weapon, rng, { bonus: attrMod(core.attrs[wpnAttr]), crit: atk.crit });
			target.hp_cur = Math.max(0, target.hp_cur - dmg);
			const heroFaster = heroSpeed <= target.speed_s;
			cues.push(
				atk.crit
					? `Твой удар застаёт ${target.name} врасплох — глубокая рана.`
					: `Ты ${heroFaster ? 'опережаешь' : 'достаёшь'} ${target.name}: удар проходит.`
			);
			if (target.hp_cur === 0) cues.push(`${target.name} падает.`);
		} else if (atk.fumble) {
			cues.push('Ты теряешь равновесие — открылся.');
		} else {
			cues.push(`${target.name} уходит от твоего удара.`);
		}
	}

	// Ответ живых врагов.
	for (const e of living()) {
		// Мораль: тяжело раненый или последний — может дрогнуть.
		const stage = woundStage(e.hp_cur, e.hp_max);
		if ((stage === 'тяжёлая' || stage === 'критическая') && rng.chance(0.4)) {
			e.fled = true;
			cues.push(`${e.name}, истекая кровью, обращается в бегство.`);
			continue;
		}
		const atk = resolveAttack({ attackBonus: e.attack_bonus, style: 'обычный', targetAC: heroAC }, rng);
		if (atk.hit) {
			const dmg = rollDamage(e.weapon, rng, { crit: atk.crit });
			heroHpDelta -= dmg;
			cues.push(atk.crit ? `${e.name} наносит тяжёлый удар!` : `${e.name} достаёт тебя.`);
		}
	}

	const heroHpAfter = core.hp.cur + heroHpDelta;
	const stillLiving = living();
	const ended = stillLiving.length === 0 || heroHpAfter <= 0;
	return {
		encounter,
		heroHpDelta,
		staminaDelta,
		cues,
		ended,
		victory: stillLiving.length === 0 && heroHpAfter > 0,
		heroDown: heroHpAfter <= 0
	};
}
