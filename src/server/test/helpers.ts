import { sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { createDatabase, type Db } from '../db/client';
import { runMigrations } from '../db/migrate';
import { users } from '../db/schema';
import { parseEnv } from '../env';
import type { Extractors } from '../extraction';
import { migrationsDir } from '../paths';
import { MemoryStorage } from '../storage/storage';

export const APP_URL = 'http://localhost:5173';

export type TestContext = { app: FastifyInstance; db: Db; storage: MemoryStorage; close: () => Promise<void> };

/**
 * Application complète migrée avec les vraies migrations, sur un PostgreSQL embarqué (PGlite) ou, si
 * TEST_DATABASE_URL est défini, sur un vrai serveur PostgreSQL — dont le schéma est alors RÉINITIALISÉ.
 */
export async function createTestContext(extractors?: Partial<Extractors>): Promise<TestContext> {
  const url = process.env.TEST_DATABASE_URL;
  const handle = await createDatabase(url ?? 'pglite:memory', { ssl: 'disable', max: 3 });
  if (url) {
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`drop schema public cascade`);
    await handle.db.execute(sql`create schema public`);
  }
  await runMigrations(handle, migrationsDir());
  const env = parseEnv({
    NODE_ENV: 'test',
    APP_URL,
    DATABASE_URL: 'pglite:memory',
    STORAGE_DRIVER: 'local',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '10000',
  });
  const storage = new MemoryStorage();
  const app = await buildApp({
    env,
    db: handle.db,
    storage,
    extractors: {
      meter: extractors?.meter ?? { name: 'fake', extract: async () => ({ value: 4616.4, date: '2026-10-27', time: '08:15:00', confidence: 0.9 }) },
      bill: extractors?.bill ?? { name: 'fake', extract: async () => ({ electricityKwh: 443, electricityAmount: 328_798.76 }) },
    },
    clientDir: null,
    version: 'test',
  });
  await app.ready();
  return {
    app,
    db: handle.db,
    storage,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export async function insertUser(db: Db, values: { email: string; password: string; role?: 'SUPERADMIN' | 'USER'; name?: string }) {
  const [user] = await db
    .insert(users)
    .values({ email: values.email, name: values.name ?? values.email, role: values.role ?? 'USER', passwordHash: await hashPassword(values.password) })
    .returning();
  if (!user) throw new Error('insertUser');
  return user;
}

type Response<T> = { status: number; body: T; headers: Record<string, unknown>; raw: Buffer };

/** Client HTTP de test : conserve le cookie de session et envoie l'en-tête Origin comme un navigateur. */
export class TestClient {
  cookie = '';

  constructor(private readonly app: FastifyInstance) {}

  async request<T = unknown>(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Response<T>> {
    const response = await this.app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}),
      headers: { origin: APP_URL, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    let body: unknown = response.body;
    if (String(response.headers['content-type'] ?? '').includes('application/json')) body = response.json();
    return { status: response.statusCode, body: body as T, headers: response.headers, raw: response.rawPayload };
  }

  get<T = unknown>(url: string) {
    return this.request<T>('GET', url);
  }

  post<T = unknown>(url: string, payload?: unknown) {
    return this.request<T>('POST', url, payload ?? {});
  }

  patch<T = unknown>(url: string, payload: unknown) {
    return this.request<T>('PATCH', url, payload);
  }

  delete<T = unknown>(url: string, payload?: unknown) {
    return this.request<T>('DELETE', url, payload);
  }

  async login(email: string, password: string) {
    const response = await this.post('/api/auth/login', { email, password });
    const setCookie = response.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof first === 'string') this.cookie = first.split(';')[0] ?? '';
    return response;
  }

  upload<T = unknown>(url: string, filename: string, contentType: string, data: Buffer) {
    const boundary = '----jirama-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.request<T>('POST', url, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}

/** Plus petit en-tête JPEG reconnu par la détection de type. */
export const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
