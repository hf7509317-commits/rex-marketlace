import 'dotenv/config';
import { z } from 'zod';
import { resolve } from 'node:path';
export const env = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  DATABASE_URL: z.string().min(1), PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  WEB_ORIGIN: z.string().url(), STORAGE_ROOT: z.string().default('./storage'),
  DELIVERY_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i)
}).parse(process.env);
export const origin = new URL(env.WEB_ORIGIN).origin;
export const storageRoot = resolve(env.STORAGE_ROOT);
if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Production memerlukan HTTPS');
