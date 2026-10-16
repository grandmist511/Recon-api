import argon2 from 'argon2';
import { pool } from './pool.js';
import { config } from '../config.js';

if (config.NODE_ENV !== 'development') throw new Error('Development seed is disabled outside NODE_ENV=development');
const passwordHash = await argon2.hash('recon-dev-password');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const user = await client.query(`INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`, ['dev@recon.local', 'Recon Developer', passwordHash]);
  const org = await client.query(`INSERT INTO organizations (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`, ['Recon Development']);
  const organizationId = org.rows[0]?.id ?? (await client.query('SELECT id FROM organizations WHERE name = $1', ['Recon Development'])).rows[0].id;
  await client.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [organizationId, user.rows[0].id]);
  await client.query('COMMIT');
  console.log(`Seeded dev@recon.local / recon-dev-password for organization ${organizationId}`);
} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }