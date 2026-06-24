/**
 * Поток хроники (фаза 0): ходы игрока и проза мастера. Состояния игры пока нет —
 * это вводится в фазе 1 (движок + дельты). Сейчас хроника эфемерна (в памяти).
 */

export type Speaker = 'player' | 'master' | 'system';

export interface ChronicleEntry {
	id: string;
	speaker: Speaker;
	text: string;
	/** true пока стримится проза мастера. */
	streaming?: boolean;
	/** Какая модель ответила (для прозрачности, ТЗ R2). */
	model?: string;
	usedFallback?: boolean;
}

let counter = 0;
function nextId(): string {
	counter += 1;
	return `e${counter}-${Date.now().toString(36)}`;
}

export const chronicle = $state<{ entries: ChronicleEntry[] }>({ entries: [] });

export function addEntry(speaker: Speaker, text: string, streaming = false): ChronicleEntry {
	const entry: ChronicleEntry = { id: nextId(), speaker, text, streaming };
	chronicle.entries.push(entry);
	return entry;
}

export function clearChronicle(): void {
	chronicle.entries = [];
}
