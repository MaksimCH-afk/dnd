/**
 * Сессия тонкого клиента: текущее состояние (с сервера), хроника для рендера,
 * отправка хода по SSE. Никакой игровой логики — её исполняет сервер.
 */
import type { CreationChoices, GameState } from '@rpg/engine';
import { settings } from './settings.svelte';
import { api, turn, type SnapshotRow } from './api';

export interface ChronicleEntry {
	id: string;
	speaker: 'player' | 'master' | 'system';
	text: string;
	streaming?: boolean;
	model?: string;
}

let counter = 0;
const nextId = () => `e${++counter}`;

export const session = $state<{
	state: GameState | null;
	campaignId: string | null;
	entries: ChronicleEntry[];
	busy: boolean;
	connected: boolean;
	dead: boolean;
}>({ state: null, campaignId: null, entries: [], busy: false, connected: false, dead: false });

function entriesFromState(state: GameState): ChronicleEntry[] {
	return (state.transcript ?? []).map((t) => ({ id: nextId(), speaker: t.speaker, text: t.text, ...(t.model ? { model: t.model } : {}) }));
}

export async function checkConnection(): Promise<boolean> {
	try {
		const h = await api.health(settings.serverUrl);
		session.connected = h.ok;
		return h.ok;
	} catch {
		session.connected = false;
		return false;
	}
}

/** Открыть кампанию по id (загрузить состояние с сервера). */
export async function openCampaign(id: string): Promise<void> {
	const state = await api.load(settings.serverUrl, id);
	session.campaignId = id;
	session.state = state;
	session.dead = state.character.core.hp.cur <= 0;
	session.entries = entriesFromState(state);
	if (session.entries.length === 0 && state.session.current_moment) {
		session.entries = [{ id: nextId(), speaker: 'master', text: state.session.current_moment }];
	}
}

/** Точки сохранения кампании (для отката). */
export async function listSnapshots(): Promise<SnapshotRow[]> {
	if (!session.campaignId) return [];
	return api.snapshots(settings.serverUrl, session.campaignId);
}

/** Восстановить точку сохранения (честный «загруз», ТЗ §14/§15). */
export async function restoreSnapshot(snapshotId: number): Promise<void> {
	if (!session.campaignId) return;
	const state = await api.restore(settings.serverUrl, session.campaignId, snapshotId);
	session.state = state;
	session.dead = state.character.core.hp.cur <= 0;
	session.entries = entriesFromState(state);
}

/** Создать кампанию из выбора игрока (создание персонажа — на сервере). */
export async function createCampaign(choices: CreationChoices): Promise<void> {
	const { id, state } = await api.newCampaign(settings.serverUrl, choices);
	session.campaignId = id;
	session.state = state;
	session.dead = false;
	const mods = Object.keys(state.character.modules).join(', ') || 'без модулей';
	session.entries = [
		{ id: nextId(), speaker: 'system', text: `Создан персонаж: ${state.character.core.name}, ${state.character.core.race}, ${state.character.core.directions.join('/')} · модули: ${mods}.` },
		{ id: nextId(), speaker: 'master', text: `${state.session.current_moment}\n\nЧто ты делаешь?` }
	];
}

/** Импортировать партию из 4 документов (сервер собирает состояние через LLM+движок). */
export async function importCampaign(docs: { character: string; inventory: string; npcs: string; session: string }): Promise<string[]> {
	const { id, state, warnings } = await api.importGame(settings.serverUrl, docs);
	session.campaignId = id;
	session.state = state;
	session.dead = state.character.core.hp.cur <= 0;
	session.entries = entriesFromState(state);
	return warnings ?? [];
}

/** Отправить ход: стрим прозы + system-события + финальное состояние с сервера. */
export async function sendTurn(input: string): Promise<void> {
	if (!session.campaignId || session.busy) return;
	session.entries.push({ id: nextId(), speaker: 'player', text: input });
	const master: ChronicleEntry = { id: nextId(), speaker: 'master', text: '', streaming: true };
	session.entries.push(master);
	session.busy = true;
	try {
		await turn(settings.serverUrl, session.campaignId, input, {
			onDelta: (t) => (master.text += t),
			onSystem: (t) => session.entries.push({ id: nextId(), speaker: 'system', text: t }),
			onDone: (state, meta) => {
				session.state = state;
				master.streaming = false;
				if (meta.model) master.model = meta.model;
				session.dead = Boolean(meta.dead);
				// Авторитетная хроника с сервера (вкл. player/master/system по порядку).
				session.entries = entriesFromState(state);
			},
			onError: (msg) => {
				master.streaming = false;
				master.text = master.text || `⚠ ${msg}`;
			}
		});
	} catch (e) {
		master.streaming = false;
		master.text = master.text || `⚠ Нет связи с сервером. Ход не отправлен. (${(e as Error).message})`;
	} finally {
		master.streaming = false;
		session.busy = false;
	}
}

export async function saveGame(label?: string): Promise<string> {
	if (!session.campaignId || !session.state) return 'игра не начата';
	await api.save(settings.serverUrl, session.campaignId, session.state, label);
	return `Сохранено — День ${session.state.session.day}`;
}
