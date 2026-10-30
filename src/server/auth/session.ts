import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'js_session';
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'SUPERADMIN' | 'USER';
  locale: string;
  mustChangePassword: boolean;
};

export type AuthContext = { user: AuthUser; sessionId: string };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string, ttlDays: number, meta: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string): Promise<AuthContext | null> {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      locale: users.locale,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
  }
  const { sessionId, lastSeenAt: _lastSeenAt, ...user } = row;
  return { sessionId, user };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeUserSessions(db: Db, userId: string, exceptSessionId?: string): Promise<void> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const { id } of rows) {
    if (id !== exceptSessionId) await revokeSession(db, id);
  }
}
