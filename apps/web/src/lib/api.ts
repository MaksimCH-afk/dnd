/**
 * Клиент app-сервера (hosted). Клиент тонкий: общается на игровом уровне
 * (кампании + ход), без LLM-вызовов и состояния. Состояние приходит с сервера.
 */
import type { CreationChoices, GameState } from '@rpg/engine';

/**
 * Нормализация базового адреса сервера. Пустая строка означает «тот же origin»
 * (когда клиент раздаётся самим app-сервером) — используем относительные пути.
 */
function norm(base: string): string {
	return (base ?? '').trim().replace(/\/+$/, '');
}

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

async function errBody(r: Response, path: string): Promise<Error> {
	try {
		const j = (await r.json()) as { error?: string };
		if (j?.error) return new Error(j.error);
	} catch {
		/* тело не JSON */
	}
	return new Error(`${path}: HTTP ${r.status}`);
}

async function jget<T>(base: string, path: string): Promise<T> {
	const r = await fetch(`${norm(base)}${path}`);
	if (!r.ok) throw await errBody(r, path);
	return (await r.json()) as T;
}
async function jpost<T>(base: string, path: string, body?: unknown): Promise<T> {
	const r = await fetch(`${norm(base)}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	if (!r.ok) throw await errBody(r, path);
	return (await r.json()) as T;
}

export const api = {
	health: (base: string) => jget<HealthInfo>(base, '/health'),
	campaigns: (base: string) => jget<{ campaigns: CampaignRow[] }>(base, '/campaigns').then((d) => d.campaigns),
	newCampaign: (base: string, choices: CreationChoices) =>
		jpost<{ id: string; state: GameState }>(base, '/campaigns/new', { choices }),
	importGame: (base: string, docs: { character: string; inventory: string; npcs: string; session: string }) =>
		jpost<{ id: string; state: GameState; warnings: string[] }>(base, '/campaigns/import', { docs }),
	load: (base: string, id: string) => jpost<{ state: GameState }>(base, `/campaigns/${id}/load`).then((d) => d.state),
	save: (base: string, id: string, state: GameState, snapshot?: string) =>
		jpost<{ ok: boolean }>(base, `/campaigns/${id}/save`, { state, snapshot }),
	snapshots: (base: string, id: string) =>
		jget<{ snapshots: SnapshotRow[] }>(base, `/campaigns/${id}/snapshots`).then((d) => d.snapshots),
	remove: (base: string, id: string) =>
		fetch(`${norm(base)}/campaigns/${id}`, { method: 'DELETE' }).then(() => undefined)
};

// --- Админ-конфиг (ключи/модели по ролям; пароль в заголовке) ---

export interface AdminConfigView {
	keysSet: Record<'default' | 'narrator' | 'validator' | 'director' | 'fallback', boolean>;
	models: Record<'narrator' | 'validator' | 'director' | 'fallback', string>;
	overridden: { keys: string[]; models: string[] };
}
export interface AdminConfigPatch {
	keys?: Partial<Record<'default' | 'narrator' | 'validator' | 'director' | 'fallback', string>>;
	models?: Partial<Record<'narrator' | 'validator' | 'director' | 'fallback', string>>;
}

export const adminApi = {
	get: async (base: string): Promise<AdminConfigView> => {
		const r = await fetch(`${norm(base)}/admin/config`);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return (await r.json()) as AdminConfigView;
	},
	save: async (base: string, patch: AdminConfigPatch): Promise<AdminConfigView> => {
		const r = await fetch(`${norm(base)}/admin/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (r.status === 503) throw new Error('БД недоступна — не сохранить');
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return (await r.json()) as AdminConfigView;
	}
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
