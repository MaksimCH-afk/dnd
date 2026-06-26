/**
 * Производные для UI из состояния: блок статуса (формат master.md) и
 * «нить состояния» (ТЗ §18.3) — кодирует главный ресурс-риск сборки.
 * Чистые функции (без рантайма Svelte).
 */

import type { GameState, ModuleName } from '@rpg/engine';

/** MP → монеты (1 GP=10 SP=100 MP): золото / серебро / медь. */
export function moneyParts(mp: number): { gp: number; sp: number; mp: number } {
	const abs = Math.max(0, Math.floor(mp));
	return { gp: Math.floor(abs / 100), sp: Math.floor((abs % 100) / 10), mp: abs % 10 };
}

/** MP → компактная строка «X GP Y SP Z MP» (1 GP=10 SP=100 MP). */
export function formatMoney(mp: number): string {
	const { gp, sp, mp: m } = moneyParts(mp);
	const parts: string[] = [];
	if (gp) parts.push(`${gp} GP`);
	if (sp) parts.push(`${sp} SP`);
	if (m || parts.length === 0) parts.push(`${m} MP`);
	return parts.join(' ');
}

export interface StatusField {
	label: string;
	value: string;
	mono?: boolean;
}

/** Адаптивный блок статуса: всегда базовое + условно по активным модулям. */
export function statusFields(state: GameState): StatusField[] {
	const c = state.character.core;
	const s = state.session;
	const loc = state.locations.find((l) => l.id === s.location_id);
	const fields: StatusField[] = [
		{ label: 'День', value: `${s.day} · ${s.time_of_day} · ${s.season}` },
		{ label: 'Локация', value: loc ? loc.name : s.weather ?? '—' },
		{ label: 'HP', value: `${c.hp.cur}/${c.hp.max}`, mono: true },
		{ label: 'Вынос.', value: `${c.stamina.cur}/${c.stamina.max}`, mono: true },
		{ label: 'Капитал', value: formatMoney(state.inventory.capital_mp), mono: true }
	];
	const m = state.character.modules;
	if (m.magic) fields.push({ label: 'Сила', value: m.magic.power });
	if (m.intrigue) fields.push({ label: 'След', value: heatWord(m.intrigue.heat) });
	if (m.faith) fields.push({ label: 'Вера', value: faithWord(m.faith.faith) });
	return fields;
}

function heatWord(heat: number): string {
	if (heat <= 0) return 'чисто';
	if (heat < 3) return 'слабый';
	if (heat < 6) return 'заметный';
	return 'горит';
}
function faithWord(f: number): string {
	if (f >= 3) return 'благодать';
	if (f >= 0) return 'тверда';
	if (f > -3) return 'смятение';
	return 'отступничество';
}

export interface ThreadModel {
	/** 0..1 — яркость/плотность нити. */
	intensity: number;
	/** Тон: обычный акцент или тревога. */
	tone: 'accent' | 'danger';
	pulse: boolean;
	/** Что кодирует нить (для легенды). */
	label: string;
}

const POWER_INTENSITY: Record<string, number> = {
	Полон: 0.85,
	Расходует: 0.6,
	'На исходе': 0.35,
	Истощён: 0.12
};

/** Главный ресурс-риск по приоритету активных модулей. */
export function threadModel(state: GameState): ThreadModel {
	const m = state.character.modules;
	const c = state.character.core;
	const has = (name: ModuleName) => Boolean(m[name]);

	// Боевой маг — Сила доминирует, но раны тревожат.
	if (has('magic') && m.magic) {
		const intensity = POWER_INTENSITY[m.magic.power] ?? 0.4;
		return {
			intensity,
			tone: m.magic.power === 'Истощён' ? 'danger' : 'accent',
			pulse: m.magic.power === 'Полон',
			label: 'Сила'
		};
	}
	if (has('intrigue') && m.intrigue) {
		const h = Math.min(1, m.intrigue.heat / 8);
		return { intensity: 0.2 + h * 0.7, tone: h > 0.5 ? 'danger' : 'accent', pulse: false, label: 'След / подозрение' };
	}
	if (has('faith') && m.faith) {
		const f = m.faith.faith;
		return { intensity: 0.5, tone: f < 0 ? 'danger' : 'accent', pulse: false, label: 'Вера / служение' };
	}
	if (has('combat_mastery')) {
		const stamRatio = c.stamina.max ? c.stamina.cur / c.stamina.max : 0;
		const hpRatio = c.hp.max ? c.hp.cur / c.hp.max : 1;
		return {
			intensity: 0.2 + stamRatio * 0.7,
			tone: hpRatio < 0.5 ? 'danger' : 'accent',
			pulse: false,
			label: 'Выносливость / раны'
		};
	}
	return { intensity: 0.25, tone: 'accent', pulse: false, label: 'состояние' };
}
