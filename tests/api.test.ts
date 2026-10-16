import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DataType, newDb } from 'pg-mem';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const database = newDb({ autoCreateForeignKeyIndices: true });
database.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true });
const adapter = database.adapters.createPg();
const harness = { database, pool: new adapter.Pool() };
vi.doMock('../src/db/pool.js', () => ({ pool: harness.pool }));

const app = (await import('../src/app.js')).default;
let accessToken = '';
let refreshToken = '';
let organizationId = '';
let reconciliationId = '';
let userId = '';
let reviewerId = '';

describe('Recon API', () => {
	beforeAll(async () => {
		for (const file of ['001_initial.sql', '002_review_and_preferences.sql', '003_sessions_and_sync.sql', '004_import_jobs_and_audit.sql']) {
			const sql = await readFile(new URL(`../src/db/migrations/${file}`, import.meta.url), 'utf8');
			await harness.pool.query(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
		}
		await harness.pool.query('CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
		await harness.pool.query("INSERT INTO schema_migrations (version) VALUES ('003_sessions_and_sync.sql')");
	});

	it('returns liveness, readiness, and capability responses', async () => {
		expect((await request(app).get('/health/live')).status).toBe(200);
		expect((await request(app).get('/health/ready')).status).toBe(200);
		expect((await request(app).get('/api/v1/version')).status).toBe(200);
		expect((await request(app).get('/api/v1/organizations/not-a-uuid/reconciliations')).status).toBe(400);
		const malformed = await request(app).post('/api/v1/auth/register').set('Content-Type', 'application/json').send('{');
		expect(malformed.status).toBe(400);
		expect(malformed.body.error.code).toBe('INVALID_JSON');
		expect(malformed.headers['x-request-id']).toBeTruthy();
		const oversized = await request(app).post('/api/v1/auth/register').set('Content-Type', 'application/json').send(JSON.stringify({ value: 'x'.repeat(300000) }));
		expect(oversized.status).toBe(413);
		expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${jwt.sign({ invalid: true }, 'test-secret-that-is-long-enough')}`)).status).toBe(401);
	});

	it('registers and logs in a user, then rotates the refresh token', async () => {
		const registered = await request(app).post('/api/v1/auth/register').send({ email: ' API@test.local ', password: 'password-123', displayName: ' API Tester\u0000 ' });
		expect(registered.status).toBe(201);
		expect(registered.body.data.email).toBe('api@test.local');
		expect(registered.body.data.display_name).toBe('API Tester');
		userId = registered.body.data.id;
		const login = await request(app).post('/api/v1/auth/login').send({ email: 'api@test.local', password: 'password-123' });
		expect(login.status).toBe(200);
		accessToken = login.body.data.accessToken;
		refreshToken = login.body.data.refreshToken;
		const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
		expect(refreshed.status).toBe(200);
		expect(refreshed.body.data.refreshToken).not.toBe(refreshToken);
		refreshToken = refreshed.body.data.refreshToken;
		expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
	});

	it('creates and lists organizations and reconciliations', async () => {
		const created = await request(app).post('/api/v1/organizations').set('Authorization', `Bearer ${accessToken}`).send({ name: 'API Org' });
		expect(created.status).toBe(201);
		organizationId = created.body.data.id;
		const reviewer = await request(app).post('/api/v1/auth/register').send({ email: 'reviewer@test.local', password: 'password-123', displayName: 'Reviewer' });
		reviewerId = reviewer.body.data.id;
		await harness.pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'reviewer')", [organizationId, reviewerId]);
		expect((await request(app).get('/api/v1/organizations').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		const reconciliation = await request(app).post(`/api/v1/organizations/${organizationId}/reconciliations`).set('Authorization', `Bearer ${accessToken}`).send({ accountName: 'Operating', periodStart: '2026-01-01', periodEnd: '2026-01-31', currency: 'UGX' });
		expect(reconciliation.status).toBe(201);
		reconciliationId = reconciliation.body.data.id;
		expect((await request(app).get(`/api/v1/organizations/${organizationId}/reconciliations`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
	});

	it('supports metadata manifests and rejects source content', async () => {
		const payload = { side: 'bank', fileName: 'bank.csv', sha256: 'a'.repeat(64), mimeType: 'text/csv', rowCount: 2, importedAt: '2026-02-01T00:00:00.000Z' };
		const created = await request(app).post(`/api/v1/reconciliations/${reconciliationId}/source-manifests`).set('Authorization', `Bearer ${accessToken}`).send(payload);
		expect(created.status).toBe(201);
		expect((await request(app).post(`/api/v1/reconciliations/${reconciliationId}/source-manifests`).set('Authorization', `Bearer ${accessToken}`).send(payload)).status).toBe(200);
		expect((await request(app).get(`/api/v1/reconciliations/${reconciliationId}/source-manifests`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		expect((await request(app).post(`/api/v1/reconciliations/${reconciliationId}/source-manifests`).set('Authorization', `Bearer ${accessToken}`).send({ ...payload, content: 'private' })).status).toBe(400);
		const importJob = await request(app).post(`/api/v1/reconciliations/${reconciliationId}/import-jobs`).set('Authorization', `Bearer ${accessToken}`).send({ importId: '22222222-2222-4222-8222-222222222222', side: 'bank', fileName: 'bank.csv', sha256: 'a'.repeat(64), mimeType: 'text/csv' });
		expect(importJob.status).toBe(202);
		expect((await request(app).post(`/api/v1/reconciliations/${reconciliationId}/import-jobs`).set('Authorization', `Bearer ${accessToken}`).send({ importId: '22222222-2222-4222-8222-222222222222', side: 'bank', fileName: 'bank.csv', sha256: 'a'.repeat(64), mimeType: 'text/csv' })).status).toBe(202);
	});

	it('versions policies, records review events, and exposes sign-off readiness', async () => {
		expect((await request(app).get(`/api/v1/reconciliations/${reconciliationId}/policy`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		expect((await request(app).put(`/api/v1/reconciliations/${reconciliationId}/policy`).set('Authorization', `Bearer ${accessToken}`).send({ policy: { materiality: 1000 } })).status).toBe(201);
		expect((await request(app).get(`/api/v1/reconciliations/${reconciliationId}/policy/history`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		expect((await request(app).post(`/api/v1/reconciliations/${reconciliationId}/review-events`).set('Authorization', `Bearer ${accessToken}`).send({ eventType: 'reconciliation_created', entityType: 'reconciliation', payload: { safe: true } })).status).toBe(201);
		expect((await request(app).get(`/api/v1/reconciliations/${reconciliationId}/review-events`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		const validation = await request(app).post(`/api/v1/reconciliations/${reconciliationId}/signoff/validate`).set('Authorization', `Bearer ${accessToken}`).send({ preparerUserId: userId, reviewerUserId: reviewerId });
		expect(validation.status).toBe(200);
		expect((await request(app).post(`/api/v1/reconciliations/${reconciliationId}/signoff`).set('Authorization', `Bearer ${accessToken}`).send({ preparerUserId: userId, reviewerUserId: reviewerId, readinessSnapshot: { ready: true } })).status).toBe(201);
		expect((await request(app).get(`/api/v1/reconciliations/${reconciliationId}/signoff`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		expect((await request(app).post(`/api/v1/reconciliations/${reconciliationId}/reopen`).set('Authorization', `Bearer ${accessToken}`).send({ reason: 'Correction required' })).status).toBe(200);
	});

	it('accepts idempotent metadata sync changes and lists them', async () => {
		const change = { organizationId, clientId: 'test-client', clientEventId: '11111111-1111-4111-8111-111111111111', entity: 'reconciliation', entityId: reconciliationId, operation: 'update', payload: { status: 'in_progress' } };
		expect((await request(app).post('/api/v1/sync/changes').set('Authorization', `Bearer ${accessToken}`).send(change)).status).toBe(201);
		expect((await request(app).post('/api/v1/sync/changes').set('Authorization', `Bearer ${accessToken}`).send(change)).status).toBe(200);
		expect((await request(app).get(`/api/v1/sync/changes?organizationId=${organizationId}`).set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
		const stale = { ...change, clientEventId: '33333333-3333-4333-8333-333333333333' };
		expect((await request(app).post('/api/v1/sync/changes').set('Authorization', `Bearer ${accessToken}`).send(stale)).status).toBe(409);
	});

	it('logs out and rejects reuse of the rotated refresh token', async () => {
		expect((await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`).send({ refreshToken })).status).toBe(200);
		expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken })).status).toBe(401);
	});
});