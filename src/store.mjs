import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TOOL = 'goals';

export const openStore = (file) => {
	if (file !== ':memory:') {
		mkdirSync(dirname(file), { recursive: true });
	}
	const db = new DatabaseSync(file);
	db.exec(`
		CREATE TABLE IF NOT EXISTS releases (
			tenant_id INTEGER NOT NULL,
			asker_id TEXT NOT NULL,
			tool TEXT NOT NULL,
			released_by TEXT NOT NULL,
			released_at TEXT NOT NULL,
			PRIMARY KEY (tenant_id, asker_id, tool)
		);
		CREATE TABLE IF NOT EXISTS entries (
			tenant_id INTEGER NOT NULL,
			asker_id TEXT NOT NULL,
			tool TEXT NOT NULL,
			answers TEXT NOT NULL,
			shared INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (tenant_id, asker_id, tool)
		);
	`);

	const findRelease = db.prepare(
		'SELECT released_by AS releasedBy, released_at AS releasedAt FROM releases WHERE tenant_id = ? AND asker_id = ? AND tool = ?'
	);
	const insertRelease = db.prepare(
		'INSERT OR IGNORE INTO releases (tenant_id, asker_id, tool, released_by, released_at) VALUES (?, ?, ?, ?, ?)'
	);
	const findEntry = db.prepare(
		'SELECT answers, shared, updated_at AS updatedAt FROM entries WHERE tenant_id = ? AND asker_id = ? AND tool = ?'
	);
	const upsertEntry = db.prepare(`
		INSERT INTO entries (tenant_id, asker_id, tool, answers, shared, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (tenant_id, asker_id, tool) DO UPDATE SET answers = excluded.answers, shared = excluded.shared, updated_at = excluded.updated_at
	`);
	const counts = db.prepare(`
		SELECT
			(SELECT COUNT(*) FROM releases WHERE tenant_id = ? AND tool = ?) AS released,
			(SELECT COUNT(*) FROM entries WHERE tenant_id = ? AND tool = ?) AS started,
			(SELECT COUNT(*) FROM entries WHERE tenant_id = ? AND tool = ? AND shared = 1) AS shared
	`);

	return {
		release(tenantId, askerId, by) {
			insertRelease.run(tenantId, askerId, TOOL, by, new Date().toISOString());
			return findRelease.get(tenantId, askerId, TOOL);
		},
		releaseOf(tenantId, askerId) {
			return findRelease.get(tenantId, askerId, TOOL) ?? null;
		},
		entryOf(tenantId, askerId) {
			const row = findEntry.get(tenantId, askerId, TOOL);
			return row ? { answers: JSON.parse(row.answers), shared: row.shared === 1, updatedAt: row.updatedAt } : null;
		},
		saveEntry(tenantId, askerId, answers, shared) {
			upsertEntry.run(tenantId, askerId, TOOL, JSON.stringify(answers), shared ? 1 : 0, new Date().toISOString());
			return this.entryOf(tenantId, askerId);
		},
		statistics(tenantId) {
			const row = counts.get(tenantId, TOOL, tenantId, TOOL, tenantId, TOOL);
			return { released: row.released, started: row.started, shared: row.shared };
		},
		close() {
			db.close();
		}
	};
};
