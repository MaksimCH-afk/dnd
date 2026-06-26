import pg from 'pg';
import type { ServerConfig } from './config';

export interface RuleRow {
	slug: string;
	full_text: string;
	prompt_core: string;
	version: number;
	updated_at: string;
}

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

			-- Правила мира (загрузка из .md, горячее применение без пересборки; см. rules_loading_spec).
			-- full_text — канонический текст (источник истины); prompt_core — компактная выжимка в промпт (Слой A/B).
			CREATE TABLE IF NOT EXISTS rules (
				slug        text PRIMARY KEY,
				full_text   text NOT NULL DEFAULT '',
				prompt_core text NOT NULL DEFAULT '',
				version     int  NOT NULL DEFAULT 1,
				updated_at  timestamptz NOT NULL DEFAULT now()
			);

			CREATE TABLE IF NOT EXISTS rule_versions (
				id          bigserial PRIMARY KEY,
				slug        text NOT NULL,
				version     int  NOT NULL,
				full_text   text NOT NULL,
				prompt_core text NOT NULL,
				created_at  timestamptz NOT NULL DEFAULT now()
			);
			CREATE INDEX IF NOT EXISTS rule_versions_slug_idx ON rule_versions(slug, version DESC);
		`);
	}

	/** Все правила из БД (для горячей загрузки в память при старте/после правки). */
	async getRules(): Promise<RuleRow[]> {
		const r = await this.pool.query(
			'SELECT slug, full_text, prompt_core, version, updated_at FROM rules ORDER BY slug'
		);
		return r.rows as RuleRow[];
	}

	/** Сохранить правило (новая версия + запись в историю). Возвращает новую версию. */
	async saveRule(slug: string, fullText: string, promptCore: string): Promise<RuleRow> {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const cur = await client.query('SELECT version FROM rules WHERE slug = $1', [slug]);
			const version = ((cur.rows[0]?.version as number) ?? 0) + 1;
			const r = await client.query(
				`INSERT INTO rules (slug, full_text, prompt_core, version, updated_at)
				 VALUES ($1, $2, $3, $4, now())
				 ON CONFLICT (slug) DO UPDATE SET full_text = $2, prompt_core = $3, version = $4, updated_at = now()
				 RETURNING slug, full_text, prompt_core, version, updated_at`,
				[slug, fullText, promptCore, version]
			);
			await client.query(
				'INSERT INTO rule_versions (slug, version, full_text, prompt_core) VALUES ($1, $2, $3, $4)',
				[slug, version, fullText, promptCore]
			);
			await client.query('COMMIT');
			return r.rows[0] as RuleRow;
		} catch (e) {
			await client.query('ROLLBACK');
			throw e;
		} finally {
			client.release();
		}
	}

	/** Одно правило по slug (или null). */
	async getRule(slug: string): Promise<RuleRow | null> {
		const r = await this.pool.query(
			'SELECT slug, full_text, prompt_core, version, updated_at FROM rules WHERE slug = $1',
			[slug]
		);
		return (r.rows[0] as RuleRow) ?? null;
	}

	/** Засев из бандла: создать, если нет; обновить «нетронутый» сид (version=1) при изменении
	 *  бандла; не трогать правила, отредактированные пользователем (version≥2).
	 *  Возвращает 'created' | 'refreshed' | 'kept'. */
	async seedRule(slug: string, fullText: string, promptCore: string): Promise<'created' | 'refreshed' | 'kept'> {
		const existing = await this.getRule(slug);
		if (!existing) {
			await this.pool.query(
				'INSERT INTO rules (slug, full_text, prompt_core, version, updated_at) VALUES ($1, $2, $3, 1, now())',
				[slug, fullText, promptCore]
			);
			await this.pool.query(
				'INSERT INTO rule_versions (slug, version, full_text, prompt_core) VALUES ($1, 1, $2, $3)',
				[slug, fullText, promptCore]
			);
			return 'created';
		}
		// Пользователь правил это правило — не перезаписываем сидом.
		if (existing.version > 1) return 'kept';
		// Нетронутый сид и бандл изменился — освежаем на месте (версия остаётся 1).
		if (fullText && (existing.full_text !== fullText || existing.prompt_core !== promptCore)) {
			await this.pool.query(
				'UPDATE rules SET full_text = $2, prompt_core = $3, updated_at = now() WHERE slug = $1 AND version = 1',
				[slug, fullText, promptCore]
			);
			await this.pool.query(
				'UPDATE rule_versions SET full_text = $2, prompt_core = $3 WHERE slug = $1 AND version = 1',
				[slug, fullText, promptCore]
			);
			return 'refreshed';
		}
		return 'kept';
	}

	/** Лёгкий список версий правила (без полного текста). */
	async ruleVersions(slug: string): Promise<{ version: number; created_at: string }[]> {
		const r = await this.pool.query(
			'SELECT version, created_at FROM rule_versions WHERE slug = $1 ORDER BY version DESC LIMIT 100',
			[slug]
		);
		return r.rows as { version: number; created_at: string }[];
	}

	/** Содержимое конкретной версии (для отката/предпросмотра). */
	async ruleVersion(slug: string, version: number): Promise<{ full_text: string; prompt_core: string } | null> {
		const r = await this.pool.query(
			'SELECT full_text, prompt_core FROM rule_versions WHERE slug = $1 AND version = $2',
			[slug, version]
		);
		return (r.rows[0] as { full_text: string; prompt_core: string }) ?? null;
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
