/**
 * Текстовые отчёты команд /go и /save в формате commands.md, и md-рендер канона
 * (char_sheet / char_inventory / current_session) для будущего git-экспорта.
 */

import type { ApplyResult, GameState } from '@rpg/engine';
import { formatMoney } from './status';

/** Краткий отчёт /go (commands.md, ≤30 строк). */
export function buildGoReport(state: GameState): string {
	const c = state.character.core;
	const s = state.session;
	const power = state.character.modules.magic ? ` · ✦ Сила: ${state.character.modules.magic.power}` : '';
	const statuses = c.statuses.length ? `\n⚠️ ${c.statuses.map((x) => x.effect).join(', ')}` : '';
	const timers = state.timers.length
		? `\n⏳ ${state.timers.map((t) => `${t.label}: День ${t.due_day}`).join(' · ')}`
		: '';
	return [
		`🎮 ЗАГРУЗКА · ${c.name} | День ${s.day} · ${s.time_of_day} · ${s.season}`,
		`💚 HP ${c.hp.cur}/${c.hp.max} · ⚡ ${c.stamina.cur}/${c.stamina.max} · 💰 ${formatMoney(state.inventory.capital_mp)}${power}`,
		`📍 ${state.locations.find((l) => l.id === s.location_id)?.name ?? s.weather ?? '—'}${statuses}${timers}`,
		`— ${s.current_moment}`,
		`Продолжаем?`
	].join('\n');
}

/** Краткий отчёт /save (commands.md). */
export function buildSaveReport(state: GameState, res?: ApplyResult | null): string {
	const c = state.character.core;
	const s = state.session;
	const lastCapital = state.inventory.journal.at(-1);
	const fin = lastCapital
		? `${lastCapital.delta > 0 ? '+' : ''}${formatMoney(Math.abs(lastCapital.delta))} (${lastCapital.reason})`
		: '—';
	const lines = [
		`💾 СОХРАНЕНО · День ${s.day}`,
		`ФИНАНСЫ: ${formatMoney(state.inventory.capital_mp)}${lastCapital ? ` · ${fin}` : ''}`,
		`СОСТОЯНИЕ: HP ${c.hp.cur}/${c.hp.max} · вынос. ${c.stamina.cur}/${c.stamina.max}${state.character.modules.magic ? ` · Сила ${state.character.modules.magic.power}` : ''}`,
		`ИНВЕНТАРЬ: ${state.inventory.items.length} поз.`
	];
	if (res && res.rejected.length) {
		lines.push(`ОТКЛОНЕНО: ${res.rejected.length} (см. /ask)`);
	}
	return lines.join('\n');
}

// --- md-рендер канона (для git-экспорта, ТЗ §15) ---

export function renderCharSheet(state: GameState): string {
	const c = state.character.core;
	const m = state.character.modules;
	const out: string[] = ['# ЛИСТ ПЕРСОНАЖА', ''];
	out.push(`**Имя:** ${c.name}`, `**Раса/возраст:** ${c.race}, ${c.age}`, `**Направление:** ${c.directions.join(', ')}`);
	out.push(`**HP:** ${c.hp.cur}/${c.hp.max}`, `**Выносливость:** ${c.stamina.cur}/${c.stamina.max}`);
	if (m.magic) {
		out.push(`**Сила:** ${m.magic.power} (${m.magic.mage_type})`);
		out.push(`**Школы:** ${m.magic.schools.map((s) => `${s.school} (${s.mastery})`).join(', ')}`);
		if (m.magic.dark_arcs.length) out.push(`**Тёмные дуги:** ${m.magic.dark_arcs.map((a) => a.note).join('; ')}`);
	}
	if (c.statuses.length) out.push(`**Статусы:** ${c.statuses.map((s) => s.effect).join(', ')}`);
	if (c.features.length) out.push(`**Особенности:** ${c.features.join(', ')}`);
	if (c.specializations.length) out.push(`**Специализации:** ${c.specializations.join(', ')}`);
	if (c.reputation.length) out.push(`**Репутация:** ${c.reputation.map((r) => `${r.faction}: ${r.tier}`).join('; ')}`);
	out.push('', `_обновлено: День ${c.updated_day}_`);
	return out.join('\n');
}

export function renderInventory(state: GameState): string {
	const inv = state.inventory;
	const out: string[] = ['# ИНВЕНТАРЬ', '', `**Капитал:** ${formatMoney(inv.capital_mp)}`, ''];
	if (inv.journal.length) {
		out.push('## Последние операции');
		for (const j of inv.journal.slice(-3)) {
			out.push(`- День ${j.day}: ${j.delta > 0 ? '+' : ''}${formatMoney(Math.abs(j.delta))} — ${j.reason}`);
		}
		out.push('');
	}
	out.push('## Предметы');
	for (const it of inv.items) {
		const charges = it.charges != null ? ` [заряды: ${it.charges}]` : '';
		out.push(`- ${it.name} ×${it.qty} (${it.slot})${it.magical ? ' ✦' : ''}${charges}`);
	}
	return out.join('\n');
}

export function renderSession(state: GameState): string {
	const s = state.session;
	return [
		'# ТЕКУЩАЯ СЕССИЯ',
		'',
		`**Дата:** День ${s.day}, ${s.time_of_day}, ${s.season}`,
		`**Погода:** ${s.weather ?? '—'}`,
		'',
		'## ТЕКУЩИЙ МОМЕНТ',
		s.current_moment,
		'',
		`## АКТИВНЫЕ NPC`,
		s.npcs_in_scene.length ? s.npcs_in_scene.map((n) => `- ${n}`).join('\n') : '- —',
		'',
		'## ТАЙМЕРЫ',
		state.timers.length ? state.timers.map((t) => `- ${t.label}: День ${t.due_day}`).join('\n') : '- —'
	].join('\n');
}

/** Полный сейв-бандл (JSON-канон + md-рендеры) для скачивания/экспорта. */
export function buildSaveBundle(state: GameState): Record<string, string> {
	return {
		'canon.json': JSON.stringify(state, null, 2),
		'char_sheet.md': renderCharSheet(state),
		'char_inventory.md': renderInventory(state),
		'current_session.md': renderSession(state)
	};
}
