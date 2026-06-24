import { migrate, type GameState } from '@rpg/engine';
import type { Db } from './db';

export interface CampaignRow {
	id: string;
	name: string;
	schema_version: number;
	updated_at: string;
}

function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 24) || 'camp'
	);
}

export class Campaigns {
	constructor(private db: Db) {}

	async list(): Promise<CampaignRow[]> {
		const r = await this.db.pool.query(
			'SELECT id, name, schema_version, updated_at FROM campaigns ORDER BY updated_at DESC'
		);
		return r.rows as CampaignRow[];
	}

	async create(name: string, state: GameState): Promise<string> {
		// уникальный id на основе имени
		let id = slug(name);
		const exists = await this.db.pool.query('SELECT 1 FROM campaigns WHERE id LIKE $1', [`${id}%`]);
		if (exists.rowCount) id = `${id}-${(exists.rowCount ?? 0) + 1}`;
		await this.db.pool.query(
			'INSERT INTO campaigns (id, name, state, schema_version) VALUES ($1, $2, $3, $4)',
			[id, name, state, state.schema_version]
		);
		return id;
	}

	async load(id: string): Promise<GameState | null> {
		const r = await this.db.pool.query('SELECT state FROM campaigns WHERE id = $1', [id]);
		if (!r.rowCount) return null;
		return migrate(r.rows[0].state).state; // миграция схемы при загрузке
	}

	async save(id: string, state: GameState): Promise<void> {
		await this.db.pool.query(
			'UPDATE campaigns SET state = $2, schema_version = $3, updated_at = now() WHERE id = $1',
			[id, state, state.schema_version]
		);
	}

	async remove(id: string): Promise<void> {
		await this.db.pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
	}

	// --- Снапшоты (точки сохранения, ТЗ §15 hosted) ---

	async snapshot(id: string, label: string, state: GameState): Promise<number> {
		const r = await this.db.pool.query(
			'INSERT INTO snapshots (campaign_id, label, day, state) VALUES ($1, $2, $3, $4) RETURNING id',
			[id, label, state.session.day, state]
		);
		return r.rows[0].id as number;
	}

	async snapshots(id: string): Promise<{ id: number; label: string; day: number; created_at: string }[]> {
		const r = await this.db.pool.query(
			'SELECT id, label, day, created_at FROM snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 50',
			[id]
		);
		return r.rows;
	}

	async restore(snapshotId: number): Promise<{ campaignId: string; state: GameState } | null> {
		const r = await this.db.pool.query('SELECT campaign_id, state FROM snapshots WHERE id = $1', [snapshotId]);
		if (!r.rowCount) return null;
		const campaignId = r.rows[0].campaign_id as string;
		const state = migrate(r.rows[0].state).state;
		await this.save(campaignId, state);
		return { campaignId, state };
	}
}
