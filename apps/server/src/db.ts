import pg from 'pg';
import type { ServerConfig } from './config';

/** Пул Postgres + идемпотентные миграции схемы (ТЗ §15 hosted). */
export class Db {
	readonly pool: pg.Pool;
	constructor(cfg: ServerConfig) {
		this.pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 });
	}

	async migrate(): Promise<void> {
		// pgvector dim 1024 — под bge-m3 (см. C-раздел патча). Фиксируется здесь.
		await this.pool.query(`
			CREATE EXTENSION IF NOT EXISTS vector;

			CREATE TABLE IF NOT EXISTS campaigns (
				id            text PRIMARY KEY,
				name          text NOT NULL,
				state         jsonb NOT NULL,
				schema_version int NOT NULL DEFAULT 1,
				created_at    timestamptz NOT NULL DEFAULT now(),
				updated_at    timestamptz NOT NULL DEFAULT now()
			);

			CREATE TABLE IF NOT EXISTS snapshots (
				id          bigserial PRIMARY KEY,
				campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
				label       text,
				day         int,
				state       jsonb NOT NULL,
				created_at  timestamptz NOT NULL DEFAULT now()
			);
			CREATE INDEX IF NOT EXISTS snapshots_campaign_idx ON snapshots(campaign_id, created_at DESC);

			CREATE TABLE IF NOT EXISTS vectors (
				id          bigserial PRIMARY KEY,
				campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
				kind        text NOT NULL,
				ref_id      text NOT NULL,
				text        text NOT NULL,
				embedding   vector(1024),
				day         int,
				UNIQUE (campaign_id, ref_id)
			);
			CREATE INDEX IF NOT EXISTS vectors_campaign_idx ON vectors(campaign_id);

			CREATE TABLE IF NOT EXISTS logs (
				id          bigserial PRIMARY KEY,
				campaign_id text,
				ts          bigint,
				turn_id     int,
				seq         int,
				type        text,
				level       text,
				payload     jsonb
			);
			CREATE INDEX IF NOT EXISTS logs_campaign_turn_idx ON logs(campaign_id, turn_id);

			CREATE TABLE IF NOT EXISTS config (
				id         int PRIMARY KEY DEFAULT 1,
				data       jsonb NOT NULL DEFAULT '{}'::jsonb,
				updated_at timestamptz NOT NULL DEFAULT now(),
				CONSTRAINT config_singleton CHECK (id = 1)
			);
		`);
	}

	/** Весь конфиг-документ из БД: { overrides?, admin? }. Пусто — {}. */
	async getConfig(): Promise<Record<string, unknown>> {
		const r = await this.pool.query('SELECT data FROM config WHERE id = 1');
		return (r.rows[0]?.data as Record<string, unknown>) ?? {};
	}

	async setConfig(data: unknown): Promise<void> {
		await this.pool.query(
			`INSERT INTO config (id, data, updated_at) VALUES (1, $1, now())
			 ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
			[JSON.stringify(data)]
		);
	}

	/** Выгрузка служебных логов (NDJSON-события ходов), свежие сверху. */
	async exportLogs(limit = 50000): Promise<unknown[]> {
		const r = await this.pool.query(
			`SELECT campaign_id, ts, turn_id, seq, type, level, payload
			 FROM logs ORDER BY id DESC LIMIT $1`,
			[limit]
		);
		return r.rows;
	}

	async healthy(): Promise<boolean> {
		try {
			await this.pool.query('SELECT 1');
			return true;
		} catch {
			return false;
		}
	}
}
