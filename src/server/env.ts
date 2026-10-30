import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    APP_URL: z.url(),
    /** Origines supplémentaires autorisées (séparées par des virgules). */
    CORS_ORIGINS: z.string().optional(),
    TRUST_PROXY: bool.default(true),

    DATABASE_URL: z.string().min(1),
    MIGRATION_DATABASE_URL: z.string().optional(),
    DATABASE_SSL: z.enum(['auto', 'require', 'verify-full', 'disable']).default('auto'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    COOKIE_SECURE: bool.optional(),

    STORAGE_DRIVER: z.enum(['supabase', 'local']).default('supabase'),
    SUPABASE_URL: z.url().optional(),
    /** Non utilisée par le serveur ; documentée pour un éventuel usage client futur (clé publique). */
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(3).default('jirama-share'),
    LOCAL_STORAGE_DIR: z.string().default('.data/uploads'),
    UPLOAD_MAX_MB: z.coerce.number().min(1).max(50).default(10),

    EXTRACTOR_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_FILE: z.string().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'STORAGE_DRIVER=supabase exige SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY' });
    }
    if (env.EXTRACTOR_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'EXTRACTOR_PROVIDER=anthropic exige ANTHROPIC_API_KEY' });
    }
  });

export type Env = z.infer<typeof EnvSchema> & { cookieSecure: boolean; allowedOrigins: string[] };

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide (.env) :\n${details}`);
  }
  const env = result.data;
  const appOrigin = new URL(env.APP_URL).origin;
  const extra = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => new URL(o).origin);
  return {
    ...env,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    allowedOrigins: [...new Set([appOrigin, ...extra])],
  };
}

/** Charge `.env` s'il existe (sans écraser les variables déjà définies par l'hébergeur). */
export function loadDotEnv(root: string): void {
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
