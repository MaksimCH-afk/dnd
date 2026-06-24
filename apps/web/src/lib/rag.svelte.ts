/**
 * RAG-ретривал (ТЗ §10, чинит №2): локальные эмбеддинги через transformers.js,
 * векторный индекс в IndexedDB, cosine top-k перед сборкой контекста.
 *
 * Эмбеддер ленивый (dynamic import) — тяжёлая модель грузится только при первом
 * использовании. Мультиязычный, сильный в русском (multilingual-e5 / bge-m3),
 * сменный через настройки. Graceful fallback: если модель недоступна (офлайн,
 * отказ), ретривал возвращает пусто — вызывающий код использует свежие факты.
 */

import { IdbStore } from './idb';

export interface VectorRecord {
	id: string;
	kind: 'fact' | 'npc' | 'chronicle';
	text: string;
	vector: number[];
	day: number;
}

export interface RagStatus {
	ready: boolean;
	loading: boolean;
	model: string;
	error?: string;
	progress?: number;
}

const store = typeof indexedDB !== 'undefined' ? new IdbStore<VectorRecord>('rpg-rag', 'vectors') : null;

export const ragStatus = $state<RagStatus>({ ready: false, loading: false, model: '' });

// Тип extractor намеренно мягкий — transformers.js грузится динамически.
type Extractor = (text: string | string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
let extractor: Extractor | null = null;
let loadPromise: Promise<Extractor | null> | null = null;

/**
 * Ленивая загрузка эмбеддера. Модель по умолчанию — компактная мультиязычная
 * (хороший русский recall, разумный размер). Сменна через параметр.
 */
export async function ensureEmbedder(model = 'Xenova/multilingual-e5-small'): Promise<Extractor | null> {
	if (extractor) return extractor;
	if (loadPromise) return loadPromise;
	ragStatus.loading = true;
	ragStatus.model = model;
	loadPromise = (async () => {
		try {
			const tf = await import('@huggingface/transformers');
			const pipe = await tf.pipeline('feature-extraction', model, {
				progress_callback: (p: unknown) => {
					const pr = (p as { progress?: number }).progress;
					if (typeof pr === 'number') ragStatus.progress = pr;
				}
			});
			extractor = pipe as unknown as Extractor;
			ragStatus.ready = true;
			return extractor;
		} catch (e) {
			ragStatus.error = (e as Error).message;
			return null;
		} finally {
			ragStatus.loading = false;
		}
	})();
	return loadPromise;
}

async function embed(text: string): Promise<number[] | null> {
	const ex = await ensureEmbedder();
	if (!ex) return null;
	// e5-модели ждут префикс; mean-pooling + нормализация.
	const out = await ex(`query: ${text}`, { pooling: 'mean', normalize: true });
	return out.tolist()[0] ?? null;
}

/** Проиндексировать сущность (эмбеддинг + запись в индекс). No-op без эмбеддера. */
export async function indexItem(rec: Omit<VectorRecord, 'vector'>): Promise<void> {
	if (!store) return;
	const vector = await embed(rec.text);
	if (!vector) return; // эмбеддер недоступен — пропускаем (fallback)
	await store.set(rec.id, { ...rec, vector });
}

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length && i < b.length; i++) dot += a[i]! * b[i]!;
	return dot; // векторы нормализованы → косинус = скалярное произведение
}

export interface RetrievedItem {
	id: string;
	kind: VectorRecord['kind'];
	text: string;
	score: number;
}

/** Top-k релевантных сущностей по эмбеддингу запроса. Пусто, если эмбеддер не готов. */
export async function retrieve(query: string, k = 6): Promise<RetrievedItem[]> {
	if (!store) return [];
	const qv = await embed(query);
	if (!qv) return [];
	const all = await store.getAll();
	return all
		.map((r) => ({ id: r.id, kind: r.kind, text: r.text, score: cosine(qv, r.vector) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, k);
}

/** Очистить индекс (например, при загрузке другой кампании). */
export async function clearIndex(): Promise<void> {
	if (!store) return;
	for (const k of await store.keys()) await store.delete(k);
}
