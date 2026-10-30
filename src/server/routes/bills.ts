import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AllocationDetailDto, AllocationSummaryDto, BillDto, SimulationDto } from '@shared/api';
import type { AllocationOutcome } from '@shared/billing/types';
import { AllocationConfigSchema, AllocationCreateSchema, BillSchema, BillUpdateSchema, DeleteWithReasonSchema } from '@shared/schemas';
import { isSuperadmin, requirePermission } from '../auth/access';
import type { AuthUser } from '../auth/session';
import type { DbOrTx } from '../db/client';
import { allocations, billDocuments, bills, files } from '../db/schema';
import { BuildingParams, IdParams, parse, requestMeta, requireAuth } from '../http/context';
import { badRequest, forbidden } from '../http/errors';
import {
  allocationDetail,
  billDtos,
  buildAllocationDraft,
  getAllocationOrThrow,
  getBillOrThrow,
  lockAllocation,
  persistAllocation,
  resolveEngineInput,
  simulate,
  userNames,
  validateAllocation,
} from '../services/allocations';
import { audit, diff } from '../services/audit';
import { toAllocationSummaryDto } from '../services/dto';
import { getSettings } from '../services/settings';
import type { AppDeps } from '../types';

/** Champs dont la modification change le résultat d'une répartition. */
const CRITICAL_FIELDS = [
  'periodStart',
  'periodEnd',
  'days',
  'mainMeterPreviousIndex',
  'mainMeterCurrentIndex',
  'electricityKwh',
  'electricityAmount',
  'waterAmount',
  'totalAmount',
] as const;

const toNumeric = (value: number | null | undefined) => (value === undefined ? undefined : value === null ? null : String(value));

async function attachDocuments(db: DbOrTx, billId: string, buildingId: string, fileIds: string[] | undefined, userId: string): Promise<void> {
  if (!fileIds?.length) return;
  const rows = await db
    .select()
    .from(files)
    .where(and(inArray(files.id, fileIds), eq(files.buildingId, buildingId), isNull(files.deletedAt)));
  if (rows.length !== new Set(fileIds).size) throw badRequest('Document introuvable pour ce bâtiment');
  await db
    .insert(billDocuments)
    .values(rows.map((f) => ({ billId, fileId: f.id, kind: f.kind, createdBy: userId })))
    .onConflictDoNothing();
}

async function hasLockedAllocation(db: DbOrTx, billId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: allocations.id })
    .from(allocations)
    .where(and(eq(allocations.billId, billId), eq(allocations.status, 'LOCKED')))
    .limit(1);
  return Boolean(row);
}

function toSimulationDto(outcome: AllocationOutcome): SimulationDto {
  if (!outcome.ok) {
    return { ok: false, warnings: outcome.warnings, errors: outcome.errors, calculationDetails: outcome.calculationDetails, partial: outcome.partial };
  }
  return {
    ok: true,
    consumers: outcome.consumers,
    totalKwh: outcome.totalKwh,
    totalElectricityAmount: outcome.totalElectricityAmount,
    totalWaterAmount: outcome.totalWaterAmount,
    totalAmount: outcome.totalAmount,
    totalPayable: outcome.totalPayable,
    effectivePricePerKwh: outcome.effectivePricePerKwh,
    warnings: outcome.warnings,
    errors: [],
    calculationDetails: outcome.calculationDetails,
  };
}

async function canOverride(db: DbOrTx, user: AuthUser): Promise<boolean> {
  return isSuperadmin(user) || (await getSettings(db)).managersCanOverride;
}

export function registerBillRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/buildings/:buildingId/bills', async (request): Promise<BillDto[]> => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'bill.read');
    const rows = await db
      .select()
      .from(bills)
      .where(and(eq(bills.buildingId, buildingId), isNull(bills.deletedAt)))
      .orderBy(desc(bills.periodStart));
    return billDtos(db, rows);
  });

  app.post('/api/buildings/:buildingId/bills', async (request, reply) => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    await requirePermission(db, auth.user, buildingId, 'bill.write');
    const body = parse(BillSchema, request.body);
    const { documentFileIds, ...fields } = body;
    const created = await db.transaction(async (tx) => {
      const [bill] = await tx
        .insert(bills)
        .values({
          ...fields,
          buildingId,
          mainMeterPreviousIndex: toNumeric(fields.mainMeterPreviousIndex) ?? null,
          mainMeterCurrentIndex: toNumeric(fields.mainMeterCurrentIndex) ?? null,
          electricityKwh: String(fields.electricityKwh),
          electricityAmount: String(fields.electricityAmount),
          waterAmount: String(fields.waterAmount),
          totalAmount: String(fields.totalAmount),
          createdBy: auth.user.id,
        })
        .returning();
      if (!bill) throw new Error('Création de la facture impossible');
      await attachDocuments(tx, bill.id, buildingId, documentFileIds, auth.user.id);
      await audit(tx, requestMeta(request), { action: 'bill.create', entityType: 'bill', entityId: bill.id, buildingId, billId: bill.id, newValue: fields });
      return bill;
    });
    const [dto] = await billDtos(db, [created]);
    return reply.status(201).send(dto);
  });

  app.get('/api/bills/:id', async (request): Promise<BillDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'bill.read');
    const [dto] = await billDtos(db, [bill]);
    if (!dto) throw new Error('Facture introuvable');
    return dto;
  });

  /**
   * Modification d'une facture. Une facture déjà répartie passe « à recalculer » ; une facture
   * verrouillée n'est modifiable que par le SUPERADMIN, et toujours avec une raison.
   */
  app.patch('/api/bills/:id', async (request): Promise<BillDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'bill.write');
    const body = parse(BillUpdateSchema, request.body);
    const { documentFileIds, reason, ...fields } = body;
    const { mainMeterPreviousIndex, mainMeterCurrentIndex, electricityKwh, electricityAmount, waterAmount, totalAmount, ...rest } = fields;
    const required = (v: number | undefined) => (v === undefined ? undefined : String(v));
    const values = {
      ...rest,
      mainMeterPreviousIndex: toNumeric(mainMeterPreviousIndex),
      mainMeterCurrentIndex: toNumeric(mainMeterCurrentIndex),
      electricityKwh: required(electricityKwh),
      electricityAmount: required(electricityAmount),
      waterAmount: required(waterAmount),
      totalAmount: required(totalAmount),
    };
    const changes = diff(bill, values);
    const criticalChanged = changes ? CRITICAL_FIELDS.filter((f) => f in changes.newValue) : [];
    const allocated = bill.calculationStatus !== 'NOT_CALCULATED';
    if (criticalChanged.length > 0) {
      if ((await hasLockedAllocation(db, id)) && !isSuperadmin(auth.user)) {
        throw forbidden('Facture verrouillée : seul le super-administrateur peut la modifier');
      }
      if (allocated && !reason) throw badRequest('Cette facture a déjà été répartie : indiquez la raison de la modification');
    }
    const updates = {
      ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)),
      ...(criticalChanged.length > 0 && allocated ? { calculationStatus: 'OUTDATED' as const } : {}),
    };
    await db.transaction(async (tx) => {
      if (Object.keys(updates).length > 0) await tx.update(bills).set(updates).where(eq(bills.id, id));
      await attachDocuments(tx, id, bill.buildingId, documentFileIds, auth.user.id);
      if (changes) {
        await audit(tx, requestMeta(request), {
          action: criticalChanged.length > 0 ? 'bill.amounts_change' : 'bill.update',
          entityType: 'bill',
          entityId: id,
          buildingId: bill.buildingId,
          billId: id,
          oldValue: changes.oldValue,
          newValue: { ...changes.newValue, ...(reason ? { reason } : {}) },
        });
      }
    });
    const [dto] = await billDtos(db, [await getBillOrThrow(db, id)]);
    if (!dto) throw new Error('Facture introuvable');
    return dto;
  });

  app.delete('/api/bills/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'bill.write');
    const { reason } = parse(DeleteWithReasonSchema, request.body);
    if (['VALIDATED', 'LOCKED'].includes(bill.calculationStatus) && !isSuperadmin(auth.user)) {
      throw forbidden('Une facture dont la répartition est validée ne peut être supprimée que par le super-administrateur');
    }
    await db.transaction(async (tx) => {
      await tx.update(bills).set({ deletedAt: new Date() }).where(eq(bills.id, id));
      await audit(tx, requestMeta(request), { action: 'bill.delete', entityType: 'bill', entityId: id, buildingId: bill.buildingId, billId: id, newValue: { reason } });
    });
    return reply.status(204).send();
  });

  // --- Répartitions ----------------------------------------------------------

  app.get('/api/bills/:id/allocation-draft', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'allocation.calculate');
    return buildAllocationDraft(db, bill, await canOverride(db, auth.user));
  });

  /** Simulation : calcul complet, rien n'est enregistré. */
  app.post('/api/bills/:id/allocations/simulate', async (request): Promise<SimulationDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'allocation.calculate');
    const config = parse(AllocationConfigSchema, request.body);
    const resolved = await resolveEngineInput(db, bill, config, auth.user, await getSettings(db));
    return toSimulationDto(simulate(resolved));
  });

  app.post('/api/bills/:id/allocations', async (request, reply): Promise<AllocationDetailDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'allocation.calculate');
    const { correctionReason, ...config } = parse(AllocationCreateSchema, request.body);
    const settings = await getSettings(db);
    const created = await db.transaction(async (tx) => {
      const resolved = await resolveEngineInput(tx, bill, config, auth.user, settings);
      return persistAllocation(tx, { bill, user: auth.user, meta: requestMeta(request), config, resolved, correctionReason });
    });
    return reply.status(201).send(await allocationDetail(db, created));
  });

  app.get('/api/bills/:id/allocations', async (request): Promise<AllocationSummaryDto[]> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const bill = await getBillOrThrow(db, id);
    await requirePermission(db, auth.user, bill.buildingId, 'bill.read');
    const rows = await db.select().from(allocations).where(eq(allocations.billId, id)).orderBy(desc(allocations.version));
    const names = await userNames(db, rows.flatMap((r) => [r.createdBy, r.validatedBy]));
    return rows.map((r) => toAllocationSummaryDto(r, names));
  });

  app.get('/api/allocations/:id', async (request): Promise<AllocationDetailDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const allocation = await getAllocationOrThrow(db, id);
    const bill = await getBillOrThrow(db, allocation.billId);
    await requirePermission(db, auth.user, bill.buildingId, 'bill.read');
    return allocationDetail(db, allocation);
  });

  app.post('/api/allocations/:id/validate', async (request): Promise<AllocationDetailDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const allocation = await getAllocationOrThrow(db, id);
    const bill = await getBillOrThrow(db, allocation.billId);
    await requirePermission(db, auth.user, bill.buildingId, 'allocation.validate');
    await db.transaction((tx) => validateAllocation(tx, allocation, auth.user, requestMeta(request)));
    return allocationDetail(db, await getAllocationOrThrow(db, id));
  });

  app.post('/api/allocations/:id/lock', async (request): Promise<AllocationDetailDto> => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const allocation = await getAllocationOrThrow(db, id);
    const bill = await getBillOrThrow(db, allocation.billId);
    await requirePermission(db, auth.user, bill.buildingId, 'allocation.lock');
    await db.transaction((tx) => lockAllocation(tx, allocation, auth.user, requestMeta(request)));
    return allocationDetail(db, await getAllocationOrThrow(db, id));
  });
}
