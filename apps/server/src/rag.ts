/**
 * RAG на сервере (ТЗ §10 hosted): эмбеддер на сервере (transformers.js, CPU),
 * векторный индекс — pgvector. Эмбеддер ленивый; при недоступности модели
 * индексация/ретривал тихо пропускаются (ход продолжается без RAG).
 *
 * Размерность фиксирована схемой БД: vector(1024) → bge-m3.
 */
import type { Db } from './db';
import type { ServerConfig } from './config';

const DIM = 1024;
type Extractor = (text: string | string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;

export class Rag {
	private extractor: Extractor | null = null;
	private loading: Promise<Extractor | null> | null = null;
	constructor(
		private db: Db,
		private cfg: ServerConfig
	) {}

	private async ensure(): Promise<Extractor | null> {
		if (this.extractor) return this.extractor;
		if (this.loading) return this.loading;
		this.loading = (async () => {
			try {
				const tf = await import('@huggingface/transformers');
				const pipe = await tf.pipeline('feature-extraction', this.cfg.embedderModel);
				this.extractor = pipe as unknown as Extractor;
				console.log(`[rag] эмбеддер готов: ${this.cfg.embedderModel}`);
				return this.extractor;
			} catch (e) {
				console.error('[rag] эмбеддер недоступен, RAG отключён:', (e as Error).message);
				return null;
			}
		})();
		return this.loading;
	}

	private async embed(text: string): Promise<number[] | null> {
		const ex = await this.ensure();
		if (!ex) return null;
		const out = await ex(text, { pooling: 'mean', normalize: true });
		const vec = out.tolist()[0];
		if (!vec || vec.length !== DIM) return null; // размерность должна совпасть со схемой
		return vec;
	}

	private static toVec(arr: number[]): string {
		return `[${arr.join(',')}]`;
	}

	/** Проиндексировать сущность (upsert по ref_id). No-op без эмбеддера. */
	async index(campaignId: string, kind: string, refId: string, text: string, day: number): Promise<void> {
		const vec = await this.embed(text);
		if (!vec) return;
		try {
			await this.db.pool.query(
				`INSERT INTO vectors (campaign_id, kind, ref_id, text, embedding, day)
				 VALUES ($1, $2, $3, $4, $5::vector, $6)
				 ON CONFLICT (campaign_id, ref_id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding`,
				[campaignId, kind, refId, text, Rag.toVec(vec), day]
			);
		} catch (e) {
			console.error('[rag] index error:', (e as Error).message);
		}
	}

	/** Top-k релевантных текстов для кампании (cosine). Пусто без эмбеддера. */
	async retrieve(campaignId: string, query: string, k = 6): Promise<string[]> {
		const vec = await this.embed(query);
		if (!vec) return [];
		try {
			const r = await this.db.pool.query(
				`SELECT text FROM vectors WHERE campaign_id = $1 ORDER BY embedding <=> $2::vector LIMIT $3`,
				[campaignId, Rag.toVec(vec), k]
			);
			return r.rows.map((row) => row.text as string);
		} catch (e) {
			console.error('[rag] retrieve error:', (e as Error).message);
			return [];
		}
	}
}
