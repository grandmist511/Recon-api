import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db/pool.js';

declare global { namespace Express { interface Request { requestId: string; user?: { id: string; email: string }; } } }
export function requestId(req: Request, res: Response, next: NextFunction) { req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId); next(); }
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  res.on('finish', () => console.info(JSON.stringify({ requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt })));
  next();
}
const authAttempts = new Map<string, { count: number; resetAt: number }>();
export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const current = authAttempts.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + config.AUTH_RATE_LIMIT_WINDOW_MS } : current;
  bucket.count += 1;
  authAttempts.set(key, bucket);
  if (bucket.count > config.AUTH_RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' }, meta: { requestId: req.requestId } });
  }
  next();
}
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, meta: { requestId: req.requestId } });
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (typeof payload === 'string') throw new Error('Invalid claims');
    req.user = z.object({ id: z.string().uuid(), email: z.string().email() }).parse(payload);
    next();
  }
  catch { return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }, meta: { requestId: req.requestId } }); }
}
export async function membership(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query('SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2', [req.params.organizationId, req.user?.id]);
    if (!result.rowCount) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Organization membership required' }, meta: { requestId: req.requestId } });
    res.locals.role = result.rows[0].role; next();
  } catch (error) { next(error); }
}
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const errorRecord = error && typeof error === 'object' ? error as { code?: unknown; type?: unknown; status?: unknown } : {};
  const errorCode = typeof errorRecord.code === 'string' ? errorRecord.code : undefined;
  const errorType = typeof errorRecord.type === 'string' ? errorRecord.type : undefined;
  if (res.headersSent) return res.end();
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' }, meta: { requestId: req.requestId } });
  if (errorType === 'entity.too.large' || errorRecord.status === 413) return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the permitted size' }, meta: { requestId: req.requestId } });
  const transientCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '57P02', '57P03', '40001', '40P01', '53300', '55P03'];
  const databaseUnavailable = (errorCode !== undefined && (transientCodes.includes(errorCode) || errorCode.startsWith('08')));
  if (databaseUnavailable) { res.setHeader('Retry-After', '5'); return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'A critical backend dependency is temporarily unavailable' }, meta: { requestId: req.requestId } }); }
  if (errorCode === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' }, meta: { requestId: req.requestId } });
  if (errorCode === '23503') return res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' }, meta: { requestId: req.requestId } });
  if (errorCode === '23514' || errorCode === '22P02') return res.status(400).json({ error: { code: 'INVALID_DATA', message: 'Request contains invalid data' }, meta: { requestId: req.requestId } });
  console.error(JSON.stringify({ requestId: req.requestId, code: errorCode ?? 'INTERNAL_ERROR', status: 500 }));
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, meta: { requestId: req.requestId } });
}