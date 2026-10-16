import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  ENABLE_CLOUD_SOURCE_SYNC: z.coerce.boolean().default(false),
  ENABLE_SERVER_EXPORTS: z.coerce.boolean().default(false)
});

export const config = schema.parse(process.env);