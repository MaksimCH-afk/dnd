/** Производные для UI: блок статуса + «нить состояния» (порт с клиента). */
import type { GameState, ModuleName } from '@rpg/engine';

export function formatMoney(mp: number): string {
	const gp = Math.floor(mp / 100);
	const sp = Math.floor((mp % 100) / 10);
	const m = mp % 10;
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
	if (m.intrigue) fields.push({ label: 'След', value: m.intrigue.heat <= 0 ? 'чисто' : m.intrigue.heat < 3 ? 'слабый' : m.intrigue.heat < 6 ? 'заметный' : 'горит' });
	if (m.faith) fields.push({ label: 'Вера', value: m.faith.faith >= 3 ? 'благодать' : m.faith.faith >= 0 ? 'тверда' : 'смятение' });
	return fields;
}

export interface ThreadModel {
	intensity: number;
	tone: 'accent' | 'danger';
	pulse: boolean;
	label: string;
}

const POWER_INTENSITY: Record<string, number> = { Полон: 0.85, Расходует: 0.6, 'На исходе': 0.35, Истощён: 0.12 };

export function threadModel(state: GameState): ThreadModel {
	const m = state.character.modules;
	const c = state.character.core;
	const has = (n: ModuleName) => Boolean(m[n]);
	if (has('magic') && m.magic) {
		return { intensity: POWER_INTENSITY[m.magic.power] ?? 0.4, tone: m.magic.power === 'Истощён' ? 'danger' : 'accent', pulse: m.magic.power === 'Полон', label: 'Сила' };
	}
	if (has('intrigue') && m.intrigue) {
		const h = Math.min(1, m.intrigue.heat / 8);
		return { intensity: 0.2 + h * 0.7, tone: h > 0.5 ? 'danger' : 'accent', pulse: false, label: 'След / подозрение' };
	}
	if (has('faith') && m.faith) {
		return { intensity: 0.5, tone: m.faith.faith < 0 ? 'danger' : 'accent', pulse: false, label: 'Вера / служение' };
	}
	if (has('combat_mastery')) {
		const stam = c.stamina.max ? c.stamina.cur / c.stamina.max : 0;
		const hp = c.hp.max ? c.hp.cur / c.hp.max : 1;
		return { intensity: 0.2 + stam * 0.7, tone: hp < 0.5 ? 'danger' : 'accent', pulse: false, label: 'Выносливость / раны' };
	}
	return { intensity: 0.25, tone: 'accent', pulse: false, label: 'состояние' };
}
