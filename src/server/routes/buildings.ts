import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { BuildingDto, DashboardDto, MemberDto } from '@shared/api';
import { PERMISSIONS, type Permission, permissionsForMember } from '@shared/domain';
import { BuildingSchema, BuildingUpdateSchema, MemberSchema, MemberUpdateSchema } from '@shared/schemas';
import { isSuperadmin, requirePermission, requireSuperadmin } from '../auth/access';
import type { AuthUser } from '../auth/session';
import type { Db, DbOrTx } from '../db/client';
import { allocationItems, allocations, bills, buildingMembers, buildings, consumers, meters, users } from '../db/schema';
import { BuildingParams, IdParams, parse, requestMeta, requireAuth } from '../http/context';
import { AppError, badRequest, notFound } from '../http/errors';
import { allocationDetail, billDtos } from '../services/allocations';
import { audit, diff } from '../services/audit';
import { toBuildingDto } from '../services/dto';
import { getSettings } from '../services/settings';
import type { AppDeps } from '../types';

async function mainMeters(db: DbOrTx, buildingIds: string[]): Promise<Map<string, string>> {
  if (buildingIds.length === 0) return new Map();
  const rows = await db
    .select({ id: meters.id, buildingId: meters.buildingId })
    .from(meters)
    .where(and(inArray(meters.buildingId, buildingIds), eq(meters.type, 'MAIN'), isNull(meters.deletedAt)));
  return new Map(rows.map((r) => [r.buildingId, r.id]));
}

export async function buildingDto(db: DbOrTx, buildingId: string, permissions: Permission[]): Promise<BuildingDto> {
  const [row] = await db.select().from(buildings).where(and(eq(buildings.id, buildingId), isNull(buildings.deletedAt))).limit(1);
  if (!row) throw notFound('Bâtiment');
  return toBuildingDto(row, permissions, (await mainMeters(db, [row.id])).get(row.id) ?? null);
}

async function listBuildings(db: Db, user: AuthUser): Promise<BuildingDto[]> {
  if (isSuperadmin(user)) {
    const rows = await db.select().from(buildings).where(isNull(buildings.deletedAt)).orderBy(asc(buildings.name));
    const mains = await mainMeters(db, rows.map((r) => r.id));
    return rows.map((r) => toBuildingDto(r, [...PERMISSIONS], mains.get(r.id) ?? null));
  }
  const rows = await db
    .select({ building: buildings, member: buildingMembers })
    .from(buildingMembers)
    .innerJoin(buildings, eq(buildings.id, buildingMembers.buildingId))
    .where(and(eq(buildingMembers.userId, user.id), isNull(buildings.deletedAt)))
    .orderBy(asc(buildings.name));
  const mains = await mainMeters(db, rows.map((r) => r.building.id));
  return rows.map(({ building, member }) =>
    toBuildingDto(building, permissionsForMember(member.role, member.permissions), mains.get(building.id) ?? null),
  );
}

async function assertConsumerInBuilding(db: DbOrTx, consumerId: string | null | undefined, buildingId: string): Promise<void> {
  if (!consumerId) return;
  const [row] = await db
    .select({ id: consumers.id })
    .from(consumers)
    .where(and(eq(consumers.id, consumerId), eq(consumers.buildingId, buildingId), isNull(consumers.deletedAt)))
    .limit(1);
  if (!row) throw badRequest("Ce consommateur n'appartient pas au bâtiment");
}

export function registerBuildingRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/buildings', async (request) => listBuildings(db, requireAuth(request).user));

  app.post('/api/buildings', async (request, reply) => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const body = parse(BuildingSchema, request.body);
    const settings = await getSettings(db);
    const created = await db.transaction(async (tx) => {
      const [building] = await tx
        .insert(buildings)
        .values({
          ...body,
          defaultWaterMode: body.defaultWaterMode ?? settings.defaultWaterMode,
          roundingToleranceAr: String(body.roundingToleranceAr ?? settings.defaultToleranceAr),
          createdBy: auth.user.id,
        })
        .returning();
      if (!building) throw new Error('Création du bâtiment impossible');
      // Chaque bâtiment a un compteur principal JIRAMA : on le crée d'emblée.
      await tx.insert(meters).values({
        buildingId: building.id,
        type: 'MAIN',
        label: 'Compteur principal JIRAMA',
        serialNumber: body.jiramaMeterReference ?? null,
        normalization: 'AS_IS',
      });
      await audit(tx, requestMeta(request), { action: 'building.create', entityType: 'building', entityId: building.id, buildingId: building.id, newValue: body });
      return building;
    });
    return reply.status(201).send(await buildingDto(db, created.id, [...PERMISSIONS]));
  });

  app.get('/api/buildings/:buildingId', async (request) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    const access = await requirePermission(db, auth.user, buildingId, 'building.read');
    return buildingDto(db, buildingId, [...access.permissions]);
  });

  app.patch('/api/buildings/:buildingId', async (request) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    const access = await requirePermission(db, auth.user, buildingId, 'building.update');
    const body = parse(BuildingUpdateSchema, request.body);
    const [before] = await db.select().from(buildings).where(eq(buildings.id, buildingId)).limit(1);
    if (!before) throw notFound('Bâtiment');
    const { roundingToleranceAr, ...rest } = body;
    const values = { ...rest, ...(roundingToleranceAr !== undefined ? { roundingToleranceAr: String(roundingToleranceAr) } : {}) };
    await db.update(buildings).set(values).where(eq(buildings.id, buildingId));
    const changes = diff(before, values);
    if (changes) await audit(db, requestMeta(request), { action: 'building.update', entityType: 'building', entityId: buildingId, buildingId, ...changes });
    return buildingDto(db, buildingId, [...access.permissions]);
  });

  app.delete('/api/buildings/:buildingId', async (request, reply) => {
    const auth = requireAuth(request);
    requireSuperadmin(auth.user);
    const { buildingId } = parse(BuildingParams, request.params);
    const [row] = await db
      .update(buildings)
      .set({ deletedAt: new Date(), active: false })
      .where(and(eq(buildings.id, buildingId), isNull(buildings.deletedAt)))
      .returning({ id: buildings.id, name: buildings.name });
    if (!row) throw notFound('Bâtiment');
    await audit(db, requestMeta(request), { action: 'building.delete', entityType: 'building', entityId: buildingId, buildingId, oldValue: { name: row.name } });
    return reply.status(204).send();
  });

  // --- Membres ---------------------------------------------------------------

  app.get('/api/buildings/:buildingId/members', async (request): Promise<MemberDto[]> => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'building.manage_members');
    const rows = await db
      .select({ member: buildingMembers, user: users })
      .from(buildingMembers)
      .innerJoin(users, eq(users.id, buildingMembers.userId))
      .where(and(eq(buildingMembers.buildingId, buildingId), isNull(users.deletedAt)))
      .orderBy(asc(users.name));
    return rows.map(({ member, user }) => ({
      id: member.id,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      role: member.role,
      permissions: permissionsForMember(member.role, member.permissions),
      extraPermissions: member.permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)),
      consumerId: member.consumerId,
    }));
  });

  app.post('/api/buildings/:buildingId/members', async (request, reply) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'building.manage_members');
    const body = parse(MemberSchema, request.body);
    const [user] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${body.email.toLowerCase()}`, isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Aucun compte avec cet e-mail : demandez au super-administrateur de le créer');
    await assertConsumerInBuilding(db, body.consumerId, buildingId);
    const [member] = await db
      .insert(buildingMembers)
      .values({ buildingId, userId: user.id, role: body.role, permissions: body.permissions, consumerId: body.consumerId ?? null })
      .returning();
    await audit(db, requestMeta(request), {
      action: 'member.add',
      entityType: 'building_member',
      entityId: member?.id ?? null,
      buildingId,
      newValue: { email: user.email, role: body.role, permissions: body.permissions, consumerId: body.consumerId ?? null },
    });
    return reply.status(201).send({ id: member?.id });
  });

  app.patch('/api/members/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const [member] = await db.select().from(buildingMembers).where(eq(buildingMembers.id, id)).limit(1);
    if (!member) throw notFound('Membre');
    await requirePermission(db, auth.user, member.buildingId, 'building.manage_members');
    const body = parse(MemberUpdateSchema, request.body);
    await assertConsumerInBuilding(db, body.consumerId, member.buildingId);
    await db.update(buildingMembers).set(body).where(eq(buildingMembers.id, id));
    const changes = diff(member, body);
    if (changes) await audit(db, requestMeta(request), { action: 'member.update', entityType: 'building_member', entityId: id, buildingId: member.buildingId, ...changes });
    return { id };
  });

  app.delete('/api/members/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const [member] = await db.select().from(buildingMembers).where(eq(buildingMembers.id, id)).limit(1);
    if (!member) throw notFound('Membre');
    await requirePermission(db, auth.user, member.buildingId, 'building.manage_members');
    if (member.userId === auth.user.id) throw badRequest('Vous ne pouvez pas vous retirer vous-même du bâtiment');
    await db.delete(buildingMembers).where(eq(buildingMembers.id, id));
    await audit(db, requestMeta(request), {
      action: 'member.remove',
      entityType: 'building_member',
      entityId: id,
      buildingId: member.buildingId,
      oldValue: { userId: member.userId, role: member.role },
    });
    return reply.status(204).send();
  });

  // --- Tableau de bord -------------------------------------------------------

  app.get('/api/buildings/:buildingId/dashboard', async (request): Promise<DashboardDto> => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    const access = await requirePermission(db, auth.user, buildingId, 'building.read');
    const building = await buildingDto(db, buildingId, [...access.permissions]);
    const [consumerCount] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(consumers)
      .where(and(eq(consumers.buildingId, buildingId), eq(consumers.active, true), isNull(consumers.deletedAt)));
    const billRows = await db
      .select()
      .from(bills)
      .where(and(eq(bills.buildingId, buildingId), isNull(bills.deletedAt)))
      .orderBy(desc(bills.periodStart))
      .limit(12);
    const billList = await billDtos(db, billRows);
    const latest = billList[0] ?? null;
    const previous = billList[1] ?? null;
    const currentIds = billList.map((b) => b.currentAllocation?.id).filter((id): id is string => Boolean(id));
    const items = currentIds.length ? await db.select().from(allocationItems).where(inArray(allocationItems.allocationId, currentIds)) : [];
    let latestAllocation = null;
    if (latest?.currentAllocation) {
      const [row] = await db.select().from(allocations).where(eq(allocations.id, latest.currentAllocation.id)).limit(1);
      if (row) latestAllocation = await allocationDetail(db, row);
    }
    const percent = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 10_000) / 100 : null);
    return {
      building,
      consumersCount: consumerCount?.value ?? 0,
      latestBill: latest,
      previousBill: previous,
      latestAllocation,
      evolution: {
        kwhPercent: latest && previous ? percent(latest.electricityKwh, previous.electricityKwh) : null,
        amountPercent: latest && previous ? percent(latest.totalAmount, previous.totalAmount) : null,
      },
      monthly: [...billList].reverse().map((bill) => ({
        billId: bill.id,
        periodStart: bill.periodStart,
        periodEnd: bill.periodEnd,
        totalKwh: bill.electricityKwh,
        totalAmount: bill.totalAmount,
        perConsumer: items
          .filter((i) => i.allocationId === bill.currentAllocation?.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({ consumerId: i.consumerId, name: i.consumerName, kwh: Number(i.kwh), totalAmount: Number(i.totalAmount) })),
      })),
    };
  });
}
