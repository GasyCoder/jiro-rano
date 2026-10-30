import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ResetPasswordSchema, UserCreateSchema, UserUpdateSchema } from '@shared/schemas';
import { requireSuperadmin } from '../auth/access';
import { hashPassword } from '../auth/password';
import { revokeUserSessions } from '../auth/session';
import type { DbOrTx } from '../db/client';
import { users } from '../db/schema';
import { IdParams, parse, requestMeta, requireAuth } from '../http/context';
import { badRequest, notFound } from '../http/errors';
import { audit, diff } from '../services/audit';
import { toUserDto } from '../services/dto';
import type { AppDeps } from '../types';

async function otherActiveSuperadmins(db: DbOrTx, excludeId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'SUPERADMIN'), eq(users.active, true), isNull(users.deletedAt), ne(users.id, excludeId)));
  return rows.length;
}

export function registerUserRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/users', async (request) => {
    requireSuperadmin(requireAuth(request).user);
    const rows = await db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.name));
    return rows.map(toUserDto);
  });

  app.post('/api/users', async (request, reply) => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const body = parse(UserCreateSchema, request.body);
    const [created] = await db
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role,
        locale: body.locale,
        passwordHash: await hashPassword(body.password),
        mustChangePassword: true,
      })
      .returning();
    if (!created) throw new Error('Création du compte impossible');
    await audit(db, requestMeta(request), {
      action: 'user.create',
      entityType: 'user',
      entityId: created.id,
      newValue: { email: created.email, name: created.name, role: created.role },
    });
    return reply.status(201).send(toUserDto(created));
  });

  app.patch('/api/users/:id', async (request) => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const { id } = parse(IdParams, request.params);
    const body = parse(UserUpdateSchema, request.body);
    const [user] = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!user) throw notFound('Utilisateur');
    const losesAdmin = user.role === 'SUPERADMIN' && (body.role === 'USER' || body.active === false);
    if (losesAdmin && (await otherActiveSuperadmins(db, user.id)) === 0) {
      throw badRequest('Impossible : ce compte est le dernier super-administrateur actif');
    }
    const [updated] = await db.update(users).set(body).where(eq(users.id, id)).returning();
    if (!updated) throw notFound('Utilisateur');
    if (body.active === false || (body.role && body.role !== user.role)) await revokeUserSessions(db, id);
    const changes = diff(user, body);
    if (changes) await audit(db, requestMeta(request), { action: 'user.update', entityType: 'user', entityId: id, ...changes });
    return toUserDto(updated);
  });

  app.post('/api/users/:id/reset-password', async (request, reply) => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const { id } = parse(IdParams, request.params);
    const body = parse(ResetPasswordSchema, request.body);
    const [updated] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password), mustChangePassword: true })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!updated) throw notFound('Utilisateur');
    await revokeUserSessions(db, id);
    await audit(db, requestMeta(request), { action: 'user.password_reset', entityType: 'user', entityId: id });
    return reply.status(204).send();
  });

  app.delete('/api/users/:id', async (request, reply) => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const { id } = parse(IdParams, request.params);
    if (id === auth.user.id) throw badRequest('Vous ne pouvez pas supprimer votre propre compte');
    const [user] = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!user) throw notFound('Utilisateur');
    if (user.role === 'SUPERADMIN' && (await otherActiveSuperadmins(db, id)) === 0) {
      throw badRequest('Impossible : ce compte est le dernier super-administrateur actif');
    }
    await db.update(users).set({ active: false, deletedAt: new Date() }).where(eq(users.id, id));
    await revokeUserSessions(db, id);
    await audit(db, requestMeta(request), { action: 'user.delete', entityType: 'user', entityId: id, oldValue: { email: user.email, name: user.name } });
    return reply.status(204).send();
  });
}
