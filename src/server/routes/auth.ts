import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { MeDto, MembershipDto } from '@shared/api';
import { PERMISSIONS, permissionsForMember } from '@shared/domain';
import { ChangePasswordSchema, LoginSchema } from '@shared/schemas';
import { isSuperadmin } from '../auth/access';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../auth/password';
import { type AuthUser, createSession, revokeSession, revokeUserSessions, SESSION_COOKIE } from '../auth/session';
import type { Db } from '../db/client';
import { buildingMembers, buildings, users } from '../db/schema';
import { parse, requestMeta, requireAuth } from '../http/context';
import { AppError, badRequest } from '../http/errors';
import { audit } from '../services/audit';
import { toUserDto } from '../services/dto';
import type { AppDeps } from '../types';

export async function loadMe(db: Db, user: AuthUser): Promise<MeDto> {
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) throw new AppError(401, 'UNAUTHORIZED', 'Compte introuvable');
  let memberships: MembershipDto[];
  if (isSuperadmin(user)) {
    const rows = await db.select({ id: buildings.id, name: buildings.name }).from(buildings).where(isNull(buildings.deletedAt)).orderBy(asc(buildings.name));
    memberships = rows.map((b) => ({ buildingId: b.id, buildingName: b.name, role: 'SUPERADMIN', permissions: [...PERMISSIONS], consumerId: null }));
  } else {
    const rows = await db
      .select({ member: buildingMembers, name: buildings.name })
      .from(buildingMembers)
      .innerJoin(buildings, eq(buildings.id, buildingMembers.buildingId))
      .where(and(eq(buildingMembers.userId, user.id), isNull(buildings.deletedAt)))
      .orderBy(asc(buildings.name));
    memberships = rows.map(({ member, name }) => ({
      buildingId: member.buildingId,
      buildingName: name,
      role: member.role,
      permissions: permissionsForMember(member.role, member.permissions),
      consumerId: member.consumerId,
    }));
  }
  return { user: toUserDto(row), memberships };
}

export function registerAuthRoutes(app: FastifyInstance, { db, env }: AppDeps): void {
  const cookieOptions = (expires: Date) => ({ httpOnly: true, secure: env.cookieSecure, sameSite: 'lax' as const, path: '/', expires });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = parse(LoginSchema, request.body);
    const [user] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${body.email.toLowerCase()}`, isNull(users.deletedAt)))
      .limit(1);
    let valid = false;
    if (user) valid = await verifyPassword(body.password, user.passwordHash);
    else await burnPasswordCheck(body.password);
    const meta = requestMeta(request);
    if (!user || !valid || !user.active) {
      await audit(db, { ...meta, userId: user?.id ?? null }, { action: 'auth.login_failed', entityType: 'user', entityId: user?.id ?? null });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect');
    }
    const session = await createSession(db, user.id, env.SESSION_TTL_DAYS, { ip: request.ip, userAgent: meta.userAgent ?? undefined });
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit(db, { ...meta, userId: user.id }, { action: 'auth.login', entityType: 'user', entityId: user.id });
    void reply.setCookie(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt));
    return loadMe(db, { ...user, role: user.role });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.auth) await revokeSession(db, request.auth.sessionId);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (request) => {
    const auth = requireAuth(request, { allowPendingPasswordChange: true });
    return loadMe(db, auth.user);
  });

  app.post('/api/auth/change-password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const auth = requireAuth(request, { allowPendingPasswordChange: true });
    const body = parse(ChangePasswordSchema, request.body);
    if (body.currentPassword === body.newPassword) throw badRequest('Le nouveau mot de passe doit être différent');
    const [user] = await db.select().from(users).where(eq(users.id, auth.user.id)).limit(1);
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Mot de passe actuel incorrect');
    }
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false }).where(eq(users.id, user.id));
    await revokeUserSessions(db, user.id, auth.sessionId);
    await audit(db, requestMeta(request), { action: 'user.password_change', entityType: 'user', entityId: user.id });
    return reply.status(204).send();
  });
}

