import { and, asc, desc, eq, inArray, isNull, max, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ConsumerDto, MeterDto, ReadingDto } from '@shared/api';
import { normalizeReading } from '@shared/domain';
import {
  ConsumerSchema,
  ConsumerUpdateSchema,
  DeleteWithReasonSchema,
  MeterSchema,
  MeterUpdateSchema,
  ReadingCreateSchema,
  ReadingUpdateSchema,
  ReorderSchema,
} from '@shared/schemas';
import { z } from 'zod';
import { getBuildingAccess, requirePermission } from '../auth/access';
import type { DbOrTx } from '../db/client';
import { allocationItems, consumers, files, meterReadings, meters } from '../db/schema';
import { BuildingParams, IdParams, parse, requestMeta, requireAuth } from '../http/context';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { flagBillsUsingReading } from '../services/allocations';
import { audit, diff } from '../services/audit';
import { toConsumerDto, toMeterDto, toReadingDto } from '../services/dto';
import type { AppDeps } from '../types';

const ListQuery = z.object({ includeInactive: z.enum(['true', 'false']).optional() });
const ReadingsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

async function getConsumerOrThrow(db: DbOrTx, id: string) {
  const [row] = await db.select().from(consumers).where(and(eq(consumers.id, id), isNull(consumers.deletedAt))).limit(1);
  if (!row) throw notFound('Consommateur');
  return row;
}

async function getMeterOrThrow(db: DbOrTx, id: string) {
  const [row] = await db.select().from(meters).where(and(eq(meters.id, id), isNull(meters.deletedAt))).limit(1);
  if (!row) throw notFound('Compteur');
  return row;
}

async function getReadingOrThrow(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ reading: meterReadings, meter: meters })
    .from(meterReadings)
    .innerJoin(meters, eq(meters.id, meterReadings.meterId))
    .where(and(eq(meterReadings.id, id), isNull(meterReadings.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Relevé');
  return row;
}

/** Un sous-compteur ne peut servir qu'à un consommateur du même bâtiment. */
async function assertMeterAssignable(db: DbOrTx, meterId: string | null | undefined, buildingId: string, consumerId?: string): Promise<void> {
  if (!meterId) return;
  const meter = await getMeterOrThrow(db, meterId);
  if (meter.buildingId !== buildingId) throw badRequest("Ce compteur n'appartient pas au bâtiment");
  if (meter.type === 'MAIN' || meter.type === 'WATER') throw badRequest('Seul un sous-compteur ou un compteur commun peut être attribué à un consommateur');
  const conditions = [eq(consumers.meterId, meterId), isNull(consumers.deletedAt)];
  if (consumerId) conditions.push(ne(consumers.id, consumerId));
  const [taken] = await db.select({ name: consumers.name }).from(consumers).where(and(...conditions)).limit(1);
  if (taken) throw conflict(`Ce compteur est déjà attribué à ${taken.name}`);
}

async function consumersWithHistory(db: DbOrTx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.selectDistinct({ consumerId: allocationItems.consumerId }).from(allocationItems).where(inArray(allocationItems.consumerId, ids));
  return new Set(rows.map((r) => r.consumerId));
}

export function registerConsumerRoutes(app: FastifyInstance, { db }: AppDeps): void {
  // --- Consommateurs ---------------------------------------------------------

  app.get('/api/buildings/:buildingId/consumers', async (request): Promise<ConsumerDto[]> => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'building.read');
    const query = parse(ListQuery, request.query);
    const conditions = [eq(consumers.buildingId, buildingId), isNull(consumers.deletedAt)];
    if (query.includeInactive !== 'true') conditions.push(eq(consumers.active, true));
    const rows = await db.select().from(consumers).where(and(...conditions)).orderBy(asc(consumers.sortOrder), asc(consumers.name));
    const history = await consumersWithHistory(db, rows.map((r) => r.id));
    return rows.map((r) => toConsumerDto(r, history.has(r.id)));
  });

  app.post('/api/buildings/:buildingId/consumers', async (request, reply) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'consumer.manage');
    const body = parse(ConsumerSchema, request.body);
    if (body.allocationMode === 'SUB_METER' && !body.meterId) throw badRequest('Le mode sous-compteur exige de choisir un compteur');
    await assertMeterAssignable(db, body.meterId, buildingId);
    const created = await db.transaction(async (tx) => {
      const [last] = await tx.select({ value: max(consumers.sortOrder) }).from(consumers).where(eq(consumers.buildingId, buildingId));
      const [row] = await tx
        .insert(consumers)
        .values({
          buildingId,
          name: body.name,
          description: body.description ?? null,
          type: body.type,
          active: body.active ?? true,
          meterId: body.meterId ?? null,
          allocationMode: body.allocationMode,
          weight: String(body.weight),
          waterWeight: String(body.waterWeight),
          sortOrder: (last?.value ?? -1) + 1,
        })
        .returning();
      if (!row) throw new Error('Création du consommateur impossible');
      await audit(tx, requestMeta(request), { action: 'consumer.create', entityType: 'consumer', entityId: row.id, buildingId, newValue: body });
      return row;
    });
    return reply.status(201).send(toConsumerDto(created, false));
  });

  app.patch('/api/consumers/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const consumer = await getConsumerOrThrow(db, id);
    await requirePermission(db, auth.user, consumer.buildingId, 'consumer.manage');
    const body = parse(ConsumerUpdateSchema, request.body);
    const meterId = body.meterId !== undefined ? body.meterId : consumer.meterId;
    const mode = body.allocationMode ?? consumer.allocationMode;
    if (mode === 'SUB_METER' && !meterId) throw badRequest('Le mode sous-compteur exige de choisir un compteur');
    if (body.meterId !== undefined) await assertMeterAssignable(db, body.meterId, consumer.buildingId, id);
    const { weight, waterWeight, ...rest } = body;
    const values = {
      ...rest,
      ...(weight !== undefined ? { weight: String(weight) } : {}),
      ...(waterWeight !== undefined ? { waterWeight: String(waterWeight) } : {}),
    };
    const [updated] = await db.update(consumers).set(values).where(eq(consumers.id, id)).returning();
    if (!updated) throw notFound('Consommateur');
    const changes = diff(consumer, values);
    if (changes) {
      const methodChanged = 'allocationMode' in changes.newValue || 'meterId' in changes.newValue;
      await audit(db, requestMeta(request), {
        action: methodChanged ? 'consumer.method_change' : 'consumer.update',
        entityType: 'consumer',
        entityId: id,
        buildingId: consumer.buildingId,
        ...changes,
      });
    }
    const history = await consumersWithHistory(db, [id]);
    return toConsumerDto(updated, history.has(id));
  });

  app.post('/api/buildings/:buildingId/consumers/reorder', async (request) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'consumer.manage');
    const { ids } = parse(ReorderSchema, request.body);
    const rows = await db.select({ id: consumers.id }).from(consumers).where(and(eq(consumers.buildingId, buildingId), isNull(consumers.deletedAt)));
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) {
      throw badRequest('La liste doit contenir exactement tous les consommateurs du bâtiment');
    }
    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.update(consumers).set({ sortOrder: index }).where(eq(consumers.id, id));
      }
      await audit(tx, requestMeta(request), { action: 'consumer.reorder', entityType: 'consumer', buildingId, newValue: { ids } });
    });
    return { ids };
  });

  /** Suppression définitive seulement sans historique de répartition ; sinon il faut désactiver. */
  app.delete('/api/consumers/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const consumer = await getConsumerOrThrow(db, id);
    await requirePermission(db, auth.user, consumer.buildingId, 'consumer.manage');
    if ((await consumersWithHistory(db, [id])).size > 0) {
      throw conflict(`${consumer.name} figure dans des répartitions : désactivez-le plutôt que de le supprimer, l'historique doit rester intact.`);
    }
    await db.transaction(async (tx) => {
      await tx.delete(consumers).where(eq(consumers.id, id));
      await audit(tx, requestMeta(request), { action: 'consumer.delete', entityType: 'consumer', entityId: id, buildingId: consumer.buildingId, oldValue: { name: consumer.name } });
    });
    return reply.status(204).send();
  });

  // --- Compteurs -------------------------------------------------------------

  app.get('/api/buildings/:buildingId/meters', async (request): Promise<MeterDto[]> => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'building.read');
    const meterRows = await db.select().from(meters).where(and(eq(meters.buildingId, buildingId), isNull(meters.deletedAt))).orderBy(asc(meters.type), asc(meters.label));
    const ids = meterRows.map((m) => m.id);
    const owners = ids.length
      ? await db.select({ id: consumers.id, meterId: consumers.meterId }).from(consumers).where(and(inArray(consumers.meterId, ids), isNull(consumers.deletedAt)))
      : [];
    const result: MeterDto[] = [];
    for (const meter of meterRows) {
      const [last] = await db
        .select()
        .from(meterReadings)
        .where(and(eq(meterReadings.meterId, meter.id), isNull(meterReadings.deletedAt)))
        .orderBy(desc(meterReadings.readingDate), desc(meterReadings.readingTime))
        .limit(1);
      result.push(toMeterDto(meter, owners.find((o) => o.meterId === meter.id)?.id ?? null, last ? toReadingDto(last) : null));
    }
    return result;
  });

  app.post('/api/buildings/:buildingId/meters', async (request, reply) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'meter.manage');
    const body = parse(MeterSchema, request.body);
    const [created] = await db
      .insert(meters)
      .values({ ...body, buildingId, rolloverAt: body.rolloverAt != null ? String(body.rolloverAt) : null })
      .returning();
    if (!created) throw new Error('Création du compteur impossible');
    await audit(db, requestMeta(request), { action: 'meter.create', entityType: 'meter', entityId: created.id, buildingId, newValue: body });
    return reply.status(201).send(toMeterDto(created, null, null));
  });

  app.patch('/api/meters/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const meter = await getMeterOrThrow(db, id);
    await requirePermission(db, auth.user, meter.buildingId, 'meter.manage');
    const body = parse(MeterUpdateSchema, request.body);
    if (body.type && body.type !== meter.type) throw badRequest("Le type d'un compteur ne peut pas être modifié : créez un nouveau compteur");
    const { rolloverAt, ...rest } = body;
    const values = { ...rest, ...(rolloverAt !== undefined ? { rolloverAt: rolloverAt != null ? String(rolloverAt) : null } : {}) };
    const [updated] = await db.update(meters).set(values).where(eq(meters.id, id)).returning();
    if (!updated) throw notFound('Compteur');
    const changes = diff(meter, values);
    if (changes) await audit(db, requestMeta(request), { action: 'meter.update', entityType: 'meter', entityId: id, buildingId: meter.buildingId, ...changes });
    return toMeterDto(updated, null, null);
  });

  // --- Relevés ---------------------------------------------------------------

  app.get('/api/meters/:id/readings', async (request): Promise<ReadingDto[]> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const meter = await getMeterOrThrow(db, id);
    await requirePermission(db, auth.user, meter.buildingId, 'building.read');
    const { limit } = parse(ReadingsQuery, request.query);
    const rows = await db
      .select()
      .from(meterReadings)
      .where(and(eq(meterReadings.meterId, id), isNull(meterReadings.deletedAt)))
      .orderBy(desc(meterReadings.readingDate), desc(meterReadings.readingTime))
      .limit(limit);
    return rows.map(toReadingDto);
  });

  app.post('/api/meters/:id/readings', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const meter = await getMeterOrThrow(db, id);
    const access = await requirePermission(db, auth.user, meter.buildingId, 'reading.create');
    const body = parse(ReadingCreateSchema, request.body);
    if (body.photoFileId) {
      const [file] = await db
        .select({ buildingId: files.buildingId })
        .from(files)
        .where(and(eq(files.id, body.photoFileId), isNull(files.deletedAt)))
        .limit(1);
      if (!file || file.buildingId !== meter.buildingId) throw badRequest('Photo introuvable pour ce bâtiment');
    }
    if (body.source !== 'MANUAL' && !body.photoFileId) throw badRequest('Une lecture sur photo doit référencer la photo');
    const canValidate = access.permissions.has('reading.validate');
    const [created] = await db
      .insert(meterReadings)
      .values({
        meterId: id,
        readingDate: body.readingDate,
        readingTime: body.readingTime ?? null,
        value: String(body.value),
        normalizedValue: String(normalizeReading(body.value, meter.normalization)),
        source: body.source,
        photoFileId: body.photoFileId ?? null,
        confidenceScore: body.confidenceScore != null ? String(body.confidenceScore) : null,
        extracted: body.extracted ?? null,
        notes: body.notes ?? null,
        createdBy: auth.user.id,
        validated: canValidate,
        validatedBy: canValidate ? auth.user.id : null,
        validatedAt: canValidate ? new Date() : null,
      })
      .returning();
    if (!created) throw new Error('Enregistrement du relevé impossible');
    await audit(db, requestMeta(request), {
      action: 'reading.create',
      entityType: 'meter_reading',
      entityId: created.id,
      buildingId: meter.buildingId,
      newValue: {
        meter: meter.label,
        value: body.value,
        normalizedValue: Number(created.normalizedValue),
        date: body.readingDate,
        time: body.readingTime ?? null,
        source: body.source,
        extracted: body.extracted ?? null,
      },
    });
    return reply.status(201).send(toReadingDto(created));
  });

  /** Modifier un index déjà saisi : raison obligatoire, audit, et factures concernées « à recalculer ». */
  app.patch('/api/readings/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const { reading, meter } = await getReadingOrThrow(db, id);
    const access = await getBuildingAccess(db, auth.user, meter.buildingId);
    if (!access) throw notFound('Relevé');
    const canValidate = access.permissions.has('reading.validate');
    const ownDraft = reading.createdBy === auth.user.id && !reading.validated && access.permissions.has('reading.create');
    if (!canValidate && !ownDraft) throw forbidden();
    const body = parse(ReadingUpdateSchema, request.body);
    const { reason, value, readingTime, ...changesRequested } = body;
    // Un index modifié doit être (re)validé : il l'est d'office si l'auteur de la modification en a le droit.
    const values = {
      ...changesRequested,
      // Même représentation que PostgreSQL (HH:mm:ss) pour comparer sans faux changement.
      ...(readingTime !== undefined ? { readingTime: readingTime && readingTime.length === 5 ? `${readingTime}:00` : readingTime } : {}),
      ...(value !== undefined
        ? {
            value: String(value),
            normalizedValue: String(normalizeReading(value, meter.normalization)),
            validated: canValidate,
            validatedBy: canValidate ? auth.user.id : null,
            validatedAt: canValidate ? new Date() : null,
          }
        : {}),
    };
    const changes = diff(reading, values);
    if (!changes) return toReadingDto(reading);
    // Seuls l'index retenu, la date et l'heure influencent un calcul : une simple remarque ne rend rien « à recalculer ».
    const affectsCalculation = ['normalizedValue', 'readingDate', 'readingTime'].some((key) => key in changes.newValue);
    const updated = await db.transaction(async (tx) => {
      const billIds = affectsCalculation ? await flagBillsUsingReading(tx, id, auth.user) : [];
      const [row] = await tx.update(meterReadings).set(values).where(eq(meterReadings.id, id)).returning();
      await audit(tx, requestMeta(request), {
        action: 'reading.update',
        entityType: 'meter_reading',
        entityId: id,
        buildingId: meter.buildingId,
        oldValue: changes.oldValue,
        newValue: { ...changes.newValue, reason, outdatedBillIds: billIds },
      });
      return row;
    });
    if (!updated) throw notFound('Relevé');
    return toReadingDto(updated);
  });

  app.post('/api/readings/:id/validate', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const { reading, meter } = await getReadingOrThrow(db, id);
    await requirePermission(db, auth.user, meter.buildingId, 'reading.validate');
    if (reading.validated) return toReadingDto(reading);
    const [updated] = await db
      .update(meterReadings)
      .set({ validated: true, validatedBy: auth.user.id, validatedAt: new Date() })
      .where(eq(meterReadings.id, id))
      .returning();
    await audit(db, requestMeta(request), {
      action: 'reading.validate',
      entityType: 'meter_reading',
      entityId: id,
      buildingId: meter.buildingId,
      newValue: { value: Number(reading.value), date: reading.readingDate },
    });
    if (!updated) throw notFound('Relevé');
    return toReadingDto(updated);
  });

  app.delete('/api/readings/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const { reading, meter } = await getReadingOrThrow(db, id);
    const access = await getBuildingAccess(db, auth.user, meter.buildingId);
    if (!access) throw notFound('Relevé');
    const ownDraft = reading.createdBy === auth.user.id && !reading.validated;
    if (!access.permissions.has('reading.validate') && !ownDraft) throw forbidden();
    const { reason } = parse(DeleteWithReasonSchema, request.body);
    await db.transaction(async (tx) => {
      const billIds = await flagBillsUsingReading(tx, id, auth.user);
      await tx.update(meterReadings).set({ deletedAt: new Date() }).where(eq(meterReadings.id, id));
      await audit(tx, requestMeta(request), {
        action: 'reading.delete',
        entityType: 'meter_reading',
        entityId: id,
        buildingId: meter.buildingId,
        oldValue: { value: Number(reading.value), date: reading.readingDate, time: reading.readingTime },
        newValue: { reason, outdatedBillIds: billIds },
      });
    });
    return reply.status(204).send();
  });
}
