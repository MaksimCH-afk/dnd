/**
 * Подсистема логов (ТЗ раздел 22): NDJSON-события пишет ДВИЖОК/пайплайн
 * детерминированно (не модель). Структурно, append-only, со сквозной
 * корреляцией session_id/turn_id/seq. Логи ≠ состояние (вне git-канона).
 *
 * Реализация: in-memory ring (ротация по числу) + зеркало в IndexedDB для
 * переживания перезагрузки. Уровни trace/debug/info/warn/error.
 */

import { browser } from '$app/environment';
import { IdbStore } from './idb';
import { settings } from './settings.svelte';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type LogType =
	| 'input'
	| 'context_assembled'
	| 'mechanics'
	| 'llm_call'
	| 'proposed_ops'
	| 'validation'
	| 'applied_ops'
	| 'state_diff'
	| 'worldsim'
	| 'persist'
	| 'sync'
	| 'warn'
	| 'error';

export interface LogEvent {
	ts: number;
	session_id: string;
	turn_id: number;
	seq: number;
	type: LogType;
	level: LogLevel;
	payload: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const RING_MAX = 1000;

const store = browser ? new IdbStore<LogEvent[]>('rpg-logs', 'ring') : null;
const RING_KEY = 'ring';

const sessionId = browser && 'randomUUID' in crypto ? crypto.randomUUID() : `s_${Date.now().toString(36)}`;
let turnId = 0;
let seq = 0;
let ring: LogEvent[] = [];

/** Реактивная статистика для UI (бейдж/счётчик). */
export const logState = $state<{ count: number; turn: number }>({ count: 0, turn: 0 });

/** Загрузить прошлый ring (переживание перезагрузки). */
export async function initLogs(): Promise<void> {
	if (!store) return;
	const saved = await store.get(RING_KEY);
	if (saved?.length) {
		ring = saved.slice(-RING_MAX);
		logState.count = ring.length;
	}
}

function passes(level: LogLevel): boolean {
	const min = (settings.logLevel ?? 'info') as LogLevel;
	return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

/** Начать новый ход; возвращает turn_id для корреляции. */
export function beginTurn(): number {
	turnId += 1;
	logState.turn = turnId;
	return turnId;
}

/** Записать событие (детерминированно, движком/пайплайном). */
export function logEvent(type: LogType, payload: unknown, level: LogLevel = 'info'): void {
	if (!passes(level)) return;
	const ev: LogEvent = { ts: browser ? Date.now() : 0, session_id: sessionId, turn_id: turnId, seq: seq++, type, level, payload };
	ring.push(ev);
	if (ring.length > RING_MAX) ring = ring.slice(-RING_MAX);
	logState.count = ring.length;
}

/** Сбросить ring на диск (на границах хода/сейва). */
export async function flushLogs(): Promise<void> {
	if (store) await store.set(RING_KEY, ring.slice(-RING_MAX));
}

/** Последние k событий (для /ask и просмотра). */
export function recent(k = 50): LogEvent[] {
	return ring.slice(-k);
}

/** События конкретного хода (для /ask — курируемый срез). */
export function eventsOfTurn(turn: number): LogEvent[] {
	return ring.filter((e) => e.turn_id === turn);
}

export function currentTurn(): number {
	return turnId;
}

export async function clearLogs(): Promise<void> {
	ring = [];
	seq = 0;
	logState.count = 0;
	if (store) await store.delete(RING_KEY);
}

/** Bug-bundle (ТЗ §22.6): последние K событий + снапшот состояния + конфиг. */
export function bugBundle(stateSnapshot: unknown, lastK = 200): string {
	const ndjson = recent(lastK)
		.map((e) => JSON.stringify(e))
		.join('\n');
	const meta = {
		session_id: sessionId,
		exported_ts: browser ? Date.now() : 0,
		config: { proxyUrl: settings.proxyUrl, logLevel: settings.logLevel, ragEnabled: settings.ragEnabled, gitEnabled: settings.gitEnabled }
	};
	return JSON.stringify({ meta, state: stateSnapshot, log_ndjson: ndjson }, null, 2);
}
