import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool.js';

const migrationsUrl = new URL('./migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl))
	.filter((fileName) => fileName.endsWith('.sql'))
	.sort();

try {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`);

	for (const fileName of migrationFiles) {
		const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [fileName]);
		if (applied.rowCount) continue;

		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(await readFile(new URL(fileName, migrationsUrl), 'utf8'));
			await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName]);
			await client.query('COMMIT');
			console.log(`Applied migration ${fileName}`);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
} finally {
	await pool.end();
}

console.log('Database migrations are current');