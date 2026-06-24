/**
 * Клиент app-сервера (hosted). Клиент тонкий: общается на игровом уровне
 * (кампании + ход), без LLM-вызовов и состояния. Состояние приходит с сервера.
 */
import type { CreationChoices, GameState } from '@rpg/engine';

export interface CampaignRow {
	id: string;
	name: string;
	schema_version: number;
	updated_at: string;
}
export interface SnapshotRow {
	id: number;
	label: string;
	day: number;
	created_at: string;
}
export interface HealthInfo {
	ok: boolean;
	db: boolean;
	hasKey: boolean;
	models: Record<string, { model: string; alternative?: string }>;
	version: string;
}

async function jget<T>(base: string, path: string): Promise<T> {
	const r = await fetch(`${base}${path}`);
	if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
	return (await r.json()) as T;
}
async function jpost<T>(base: string, path: string, body?: unknown): Promise<T> {
	const r = await fetch(`${base}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
	return (await r.json()) as T;
}

export const api = {
	health: (base: string) => jget<HealthInfo>(base, '/health'),
	campaigns: (base: string) => jget<{ campaigns: CampaignRow[] }>(base, '/campaigns').then((d) => d.campaigns),
	newCampaign: (base: string, choices: CreationChoices) =>
		jpost<{ id: string; state: GameState }>(base, '/campaigns/new', { choices }),
	load: (base: string, id: string) => jpost<{ state: GameState }>(base, `/campaigns/${id}/load`).then((d) => d.state),
	save: (base: string, id: string, state: GameState, snapshot?: string) =>
		jpost<{ ok: boolean }>(base, `/campaigns/${id}/save`, { state, snapshot }),
	snapshots: (base: string, id: string) =>
		jget<{ snapshots: SnapshotRow[] }>(base, `/campaigns/${id}/snapshots`).then((d) => d.snapshots),
	remove: (base: string, id: string) =>
		fetch(`${base}/campaigns/${id}`, { method: 'DELETE' }).then(() => undefined)
};

// --- Ход (SSE) ---

export interface TurnHandlers {
	onDelta?: (text: string) => void;
	onSystem?: (text: string) => void;
	onDone?: (state: GameState, meta: { model?: string; usedFallback?: boolean }) => void;
	onError?: (message: string) => void;
}

/** Отправить ход: стрим прозы + system-события + финальное состояние. */
export async function turn(base: string, campaignId: string, input: string, h: TurnHandlers): Promise<void> {
	const res = await fetch(`${base}/turn`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ campaignId, input })
	});
	if (!res.ok || !res.body) {
		h.onError?.(`сервер ответил ${res.status}`);
		return;
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buffer.indexOf('\n\n')) !== -1) {
			const frame = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 2);
			for (const line of frame.split('\n')) {
				const t = line.trim();
				if (!t.startsWith('data:')) continue;
				try {
					const e = JSON.parse(t.slice(5).trim());
					if (e.type === 'delta') h.onDelta?.(e.text);
					else if (e.type === 'system') h.onSystem?.(e.text);
					else if (e.type === 'done') h.onDone?.(e.state, { model: e.model, usedFallback: e.usedFallback });
					else if (e.type === 'error') h.onError?.(e.message);
				} catch {
					/* неполный кадр */
				}
			}
		}
	}
}
