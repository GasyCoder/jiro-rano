import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AuditLogDto, Paginated, SettingsDto } from '@shared/api';
import { AuditQuerySchema, SettingsSchema } from '@shared/schemas';
import { isSuperadmin, requirePermission, requireSuperadmin } from '../auth/access';
import { auditLogs, users } from '../db/schema';
import { parse, requestMeta, requireAuth } from '../http/context';
import { badRequest } from '../http/errors';
import { getBillOrThrow } from '../services/allocations';
import { audit } from '../services/audit';
import { getSettings, saveSettings } from '../services/settings';
import type { AppDeps } from '../types';

export function registerSystemRoutes(app: FastifyInstance, { db, env, extractors, version }: AppDeps): void {
  app.get('/api/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', database: 'ok', version };
    } catch {
      return reply.status(503).send({ status: 'degraded', database: 'unreachable', version });
    }
  });

  app.get('/api/settings', async (request): Promise<SettingsDto> => {
    requireAuth(request);
    return { ...(await getSettings(db)), extractorProvider: extractors.meter.name, uploadMaxMb: env.UPLOAD_MAX_MB, version };
  });

  app.put('/api/settings', async (request): Promise<SettingsDto> => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const body = parse(SettingsSchema, request.body);
    const before = await getSettings(db);
    await saveSettings(db, body, auth.user.id);
    await audit(db, requestMeta(request), { action: 'settings.update', entityType: 'settings', oldValue: before, newValue: body });
    return { ...body, extractorProvider: extractors.meter.name, uploadMaxMb: env.UPLOAD_MAX_MB, version };
  });

  /** Journal d'audit : tout pour le SUPERADMIN, un bâtiment pour qui a la permission audit.read. */
  app.get('/api/audit', async (request): Promise<Paginated<AuditLogDto>> => {
    const auth = requireAuth(request);
    const query = parse(AuditQuerySchema, request.query);
    let buildingId = query.buildingId;
    if (query.billId) buildingId = (await getBillOrThrow(db, query.billId)).buildingId;
    if (!isSuperadmin(auth.user)) {
      if (!buildingId) throw badRequest('Précisez le bâtiment');
      await requirePermission(db, auth.user, buildingId, 'audit.read');
    }
    const filters: SQL[] = [];
    if (buildingId) filters.push(eq(auditLogs.buildingId, buildingId));
    if (query.billId) filters.push(eq(auditLogs.billId, query.billId));
    if (query.entityType) filters.push(eq(auditLogs.entityType, query.entityType));
    const where = filters.length ? and(...filters) : undefined;
    const [total] = await db.select({ value: count() }).from(auditLogs).where(where);
    const rows = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
    const names = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    return {
      page: query.page,
      pageSize: query.pageSize,
      total: total?.value ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.userId ? (nameById.get(r.userId) ?? null) : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        buildingId: r.buildingId,
        billId: r.billId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
