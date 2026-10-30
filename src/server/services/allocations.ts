import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { AllocationDetailDto, AllocationDraftDto, BillDto, ConsumerDto, MeterDto, ReadingDto } from '@shared/api';
import { addDays, toEpochSeconds } from '@shared/billing/dates';
import { allocateBill } from '@shared/billing/engine';
import type { AllocationInput, AllocationIssue, AllocationOutcome, ReadingPoint, WaterAllocationConfig } from '@shared/billing/types';
import { centimesToDecimalString, whToDecimalString } from '@shared/billing/units';
import type { WaterMode } from '@shared/domain';
import { type AllocationConfig, AllocationConfigSchema } from '@shared/schemas';
import { isSuperadmin } from '../auth/access';
import type { AuthUser } from '../auth/session';
import type { DbOrTx, Tx } from '../db/client';
import {
  allocationCalculationSteps,
  allocationItems,
  allocations,
  billDocuments,
  bills,
  buildings,
  consumers,
  files,
  meterReadings,
  meters,
  users,
} from '../db/schema';
import type { RequestMeta } from '../http/context';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { audit } from './audit';
import { num, toAllocationItemDto, toAllocationSummaryDto, toConsumerDto, toFileDto, toMeterDto, toReadingDto } from './dto';
import type { AppSettings } from '@shared/schemas';

export type BillRow = typeof bills.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;
type ReadingRow = typeof meterReadings.$inferSelect;

const READING_WINDOW_DAYS = 62;

export async function getBillOrThrow(db: DbOrTx, billId: string): Promise<BillRow> {
  const [bill] = await db
    .select()
    .from(bills)
    .where(and(eq(bills.id, billId), isNull(bills.deletedAt)))
    .limit(1);
  if (!bill) throw notFound('Facture');
  return bill;
}

export async function getAllocationOrThrow(db: DbOrTx, allocationId: string): Promise<AllocationRow> {
  const [allocation] = await db.select().from(allocations).where(eq(allocations.id, allocationId)).limit(1);
  if (!allocation) throw notFound('Répartition');
  return allocation;
}

export async function userNames(db: DbOrTx, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Répartition « courante » : l'officielle si elle existe, sinon la plus récente non remplacée. */
function pickCurrent(rows: AllocationRow[]): AllocationRow | null {
  return rows.find((a) => a.status === 'VALIDATED' || a.status === 'LOCKED') ?? rows.find((a) => a.status !== 'SUPERSEDED') ?? null;
}

export async function billDtos(db: DbOrTx, rows: BillRow[]): Promise<BillDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const docs = await db
    .select({ billId: billDocuments.billId, file: files })
    .from(billDocuments)
    .innerJoin(files, eq(files.id, billDocuments.fileId))
    .where(and(inArray(billDocuments.billId, ids), isNull(files.deletedAt)));
  const allocationRows = await db.select().from(allocations).where(inArray(allocations.billId, ids)).orderBy(desc(allocations.version));
  const names = await userNames(db, allocationRows.flatMap((a) => [a.createdBy, a.validatedBy]));
  return rows.map((bill) => {
    const current = pickCurrent(allocationRows.filter((a) => a.billId === bill.id));
    return {
      id: bill.id,
      buildingId: bill.buildingId,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      days: bill.days,
      mainMeterPreviousIndex: num(bill.mainMeterPreviousIndex),
      mainMeterCurrentIndex: num(bill.mainMeterCurrentIndex),
      electricityKwh: Number(bill.electricityKwh),
      electricityAmount: Number(bill.electricityAmount),
      waterAmount: Number(bill.waterAmount),
      totalAmount: Number(bill.totalAmount),
      invoiceNumber: bill.invoiceNumber,
      invoiceDate: bill.invoiceDate,
      dueDate: bill.dueDate,
      notes: bill.notes,
      status: bill.status,
      calculationStatus: bill.calculationStatus,
      createdAt: bill.createdAt.toISOString(),
      updatedAt: bill.updatedAt.toISOString(),
      documents: docs.filter((d) => d.billId === bill.id).map((d) => toFileDto(d.file)),
      currentAllocation: current ? toAllocationSummaryDto(current, names) : null,
    };
  });
}

export function waterConfigFor(mode: WaterMode): WaterAllocationConfig {
  if (mode === 'PROPORTIONAL') return { mode: 'PROPORTIONAL', key: 'KWH' };
  return mode === 'MANUAL' ? { mode: 'MANUAL' } : { mode: 'EQUAL' };
}

/** Paire de relevés la plus proche des dates de la facture (début avant fin). */
export function suggestReadings(readings: ReadingRow[], periodStart: string, periodEnd: string): { start: string | null; end: string | null } {
  const at = (r: ReadingRow) => toEpochSeconds(r.readingDate, r.readingTime);
  const startTarget = toEpochSeconds(periodStart);
  const endTarget = toEpochSeconds(periodEnd);
  let best: { start: ReadingRow; end: ReadingRow; score: number } | null = null;
  for (const start of readings) {
    for (const end of readings) {
      if (at(end) <= at(start)) continue;
      const penalty = (start.validated ? 0 : 3600) + (end.validated ? 0 : 3600);
      const score = Math.abs(at(start) - startTarget) + Math.abs(at(end) - endTarget) + penalty;
      if (!best || score < best.score) best = { start, end, score };
    }
  }
  return { start: best?.start.id ?? null, end: best?.end.id ?? null };
}

export async function buildAllocationDraft(db: DbOrTx, bill: BillRow, canOverride: boolean): Promise<AllocationDraftDto> {
  const [building] = await db.select().from(buildings).where(eq(buildings.id, bill.buildingId)).limit(1);
  if (!building) throw notFound('Bâtiment');
  const consumerRows = await db
    .select()
    .from(consumers)
    .where(and(eq(consumers.buildingId, bill.buildingId), eq(consumers.active, true), isNull(consumers.deletedAt)))
    .orderBy(asc(consumers.sortOrder), asc(consumers.name));
  const meterIds = consumerRows.map((c) => c.meterId).filter((id): id is string => Boolean(id));
  const meterRows = meterIds.length ? await db.select().from(meters).where(inArray(meters.id, meterIds)) : [];
  const readingRows = meterIds.length
    ? await db
        .select()
        .from(meterReadings)
        .where(
          and(
            inArray(meterReadings.meterId, meterIds),
            isNull(meterReadings.deletedAt),
            gte(meterReadings.readingDate, addDays(bill.periodStart, -READING_WINDOW_DAYS)),
            lte(meterReadings.readingDate, addDays(bill.periodEnd, READING_WINDOW_DAYS)),
          ),
        )
        .orderBy(asc(meterReadings.readingDate), asc(meterReadings.readingTime))
    : [];
  const historyRows = consumerRows.length
    ? await db
        .selectDistinct({ consumerId: allocationItems.consumerId })
        .from(allocationItems)
        .where(inArray(allocationItems.consumerId, consumerRows.map((c) => c.id)))
    : [];
  const withHistory = new Set(historyRows.map((r) => r.consumerId));

  const draftConsumers = consumerRows.map((consumer) => {
    const meter = meterRows.find((m) => m.id === consumer.meterId) ?? null;
    const readings = meter ? readingRows.filter((r) => r.meterId === meter.id) : [];
    const suggestion = suggestReadings(readings, bill.periodStart, bill.periodEnd);
    const consumerDto: ConsumerDto = toConsumerDto(consumer, withHistory.has(consumer.id));
    const readingDtos: ReadingDto[] = readings.map(toReadingDto);
    const meterDto: MeterDto | null = meter ? toMeterDto(meter, consumer.id, readingDtos.at(-1) ?? null) : null;
    return { consumer: consumerDto, meter: meterDto, readings: readingDtos, suggestedStartId: suggestion.start, suggestedEndId: suggestion.end };
  });

  const defaultConfig: AllocationConfig = {
    consumers: draftConsumers.map(({ consumer, suggestedStartId, suggestedEndId }) => ({
      consumerId: consumer.id,
      method: consumer.allocationMode,
      readingStartId: consumer.allocationMode === 'SUB_METER' ? suggestedStartId : null,
      readingEndId: consumer.allocationMode === 'SUB_METER' ? suggestedEndId : null,
      weight: consumer.weight,
      waterWeight: consumer.waterWeight,
    })),
    water: waterConfigFor(building.defaultWaterMode),
    toleranceAr: Number(building.roundingToleranceAr),
  };

  const [latest] = await db.select().from(allocations).where(eq(allocations.billId, bill.id)).orderBy(desc(allocations.version)).limit(1);
  let config = defaultConfig;
  if (latest) {
    const parsed = AllocationConfigSchema.safeParse(latest.config);
    const activeIds = new Set(consumerRows.map((c) => c.id));
    if (parsed.success) {
      const kept = parsed.data.consumers.filter((c) => activeIds.has(c.consumerId));
      const added = defaultConfig.consumers.filter((c) => !kept.some((k) => k.consumerId === c.consumerId));
      config = { ...parsed.data, consumers: [...kept, ...added] };
    }
  }

  const [billDto] = await billDtos(db, [bill]);
  if (!billDto) throw notFound('Facture');
  return { bill: billDto, consumers: draftConsumers, config, canOverride };
}

/** Données de la facture telles que vues par le moteur (sert aussi à détecter une facture modifiée). */
function billInput(bill: BillRow) {
  return {
    totalKwh: Number(bill.electricityKwh),
    electricityAmount: Number(bill.electricityAmount),
    waterAmount: Number(bill.waterAmount),
    billTotalAmount: Number(bill.totalAmount),
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    billDays: bill.days,
    mainMeterPreviousIndex: num(bill.mainMeterPreviousIndex),
    mainMeterCurrentIndex: num(bill.mainMeterCurrentIndex),
  };
}

export type ResolvedInput = { input: AllocationInput; issues: AllocationIssue[] };

/**
 * Transforme la configuration demandée en entrée du moteur. Les index proviennent toujours des relevés
 * enregistrés (référencés par identifiant) : une requête ne peut pas injecter une valeur de compteur.
 */
export async function resolveEngineInput(db: DbOrTx, bill: BillRow, config: AllocationConfig, user: AuthUser, settings: AppSettings): Promise<ResolvedInput> {
  const ids = config.consumers.map((c) => c.consumerId);
  if (new Set(ids).size !== ids.length) throw badRequest('Un consommateur apparaît plusieurs fois');
  const rows = await db
    .select()
    .from(consumers)
    .where(and(inArray(consumers.id, ids), eq(consumers.buildingId, bill.buildingId), isNull(consumers.deletedAt)));
  if (rows.length !== ids.length) throw badRequest('Consommateur inconnu pour ce bâtiment');
  const inactive = rows.filter((r) => !r.active);
  if (inactive.length > 0) throw badRequest(`Consommateur désactivé : ${inactive.map((r) => r.name).join(', ')}`);
  if (config.consumers.some((c) => c.override) && !(isSuperadmin(user) || settings.managersCanOverride)) {
    throw forbidden('Les corrections manuelles sont réservées au super-administrateur');
  }

  const subMeterConfigs = config.consumers.filter((c) => c.method === 'SUB_METER');
  const readingIds = [...new Set(subMeterConfigs.flatMap((c) => [c.readingStartId, c.readingEndId]).filter((id): id is string => Boolean(id)))];
  const readingRows = readingIds.length
    ? await db
        .select({ reading: meterReadings, rolloverAt: meters.rolloverAt })
        .from(meterReadings)
        .innerJoin(meters, eq(meters.id, meterReadings.meterId))
        .where(and(inArray(meterReadings.id, readingIds), isNull(meterReadings.deletedAt)))
    : [];
  const readingsById = new Map(readingRows.map((r) => [r.reading.id, r]));
  const consumerById = new Map(rows.map((r) => [r.id, r]));
  const unvalidated = new Set<string>();

  const ordered = [...config.consumers].sort((a, b) => {
    const ca = consumerById.get(a.consumerId);
    const cb = consumerById.get(b.consumerId);
    return (ca?.sortOrder ?? 0) - (cb?.sortOrder ?? 0) || (ca?.name ?? '').localeCompare(cb?.name ?? '');
  });

  const engineConsumers = ordered.map((cfg) => {
    const consumer = consumerById.get(cfg.consumerId);
    if (!consumer) throw badRequest('Consommateur inconnu');
    const point = (id: string | null | undefined): ReadingPoint | null => {
      if (!id) return null;
      const row = readingsById.get(id);
      if (!row) throw badRequest(`Relevé introuvable ou supprimé pour ${consumer.name}`);
      if (row.reading.meterId !== consumer.meterId) throw badRequest(`Le relevé choisi pour ${consumer.name} n'appartient pas à son compteur`);
      if (!row.reading.validated) unvalidated.add(consumer.name);
      return { id, value: Number(row.reading.normalizedValue), date: row.reading.readingDate, time: row.reading.readingTime };
    };
    const isSubMeter = cfg.method === 'SUB_METER';
    const startRow = isSubMeter && cfg.readingStartId ? readingsById.get(cfg.readingStartId) : undefined;
    return {
      id: consumer.id,
      name: consumer.name,
      method: cfg.method,
      readingStart: isSubMeter ? point(cfg.readingStartId) : null,
      readingEnd: isSubMeter ? point(cfg.readingEndId) : null,
      meterRolloverAt: startRow ? num(startRow.rolloverAt) : null,
      manualKwh: cfg.manualKwh ?? null,
      weight: cfg.weight ?? Number(consumer.weight),
      waterWeight: cfg.waterWeight ?? Number(consumer.waterWeight),
      manualWaterAmount: cfg.manualWaterAmount ?? null,
      override: cfg.override ?? null,
    };
  });

  const [building] = await db.select({ tolerance: buildings.roundingToleranceAr }).from(buildings).where(eq(buildings.id, bill.buildingId)).limit(1);
  const issues: AllocationIssue[] = [];
  if (unvalidated.size > 0) {
    issues.push({
      code: 'READING_NOT_VALIDATED',
      message: `Relevés pas encore validés par un gestionnaire : ${[...unvalidated].join(', ')}. La répartition peut être calculée mais pas validée.`,
    });
  }
  return {
    input: {
      ...billInput(bill),
      water: config.water,
      toleranceAr: config.toleranceAr ?? Number(building?.tolerance ?? 2),
      consumers: engineConsumers,
    },
    issues,
  };
}

export function simulate(resolved: ResolvedInput): AllocationOutcome {
  const outcome = allocateBill(resolved.input);
  return { ...outcome, warnings: [...resolved.issues, ...outcome.warnings] };
}

/** Enregistre une nouvelle version. Les versions précédentes ne sont jamais modifiées, seulement marquées remplacées. */
export async function persistAllocation(
  tx: Tx,
  params: { bill: BillRow; user: AuthUser; meta: RequestMeta; config: AllocationConfig; resolved: ResolvedInput; correctionReason?: string | undefined },
): Promise<AllocationRow> {
  const { bill, user, meta, config, resolved, correctionReason } = params;
  const existing = await tx.select().from(allocations).where(eq(allocations.billId, bill.id)).orderBy(desc(allocations.version));
  const official = existing.find((a) => a.status === 'VALIDATED' || a.status === 'LOCKED');
  if (official && !correctionReason) {
    throw badRequest('Une répartition validée existe déjà : indiquez la raison de la correction');
  }
  if (official?.status === 'LOCKED' && !isSuperadmin(user)) {
    throw forbidden('Répartition verrouillée : seul le super-administrateur peut la corriger');
  }

  const outcome = simulate(resolved);
  const version = (existing[0]?.version ?? 0) + 1;
  const toleranceAr = resolved.input.toleranceAr ?? 2;
  const [created] = await tx
    .insert(allocations)
    .values({
      billId: bill.id,
      version,
      status: outcome.ok ? 'CALCULATED' : 'DRAFT',
      engineVersion: outcome.engineVersion,
      inputSnapshot: resolved.input,
      config,
      warnings: outcome.warnings,
      errors: outcome.errors,
      totalKwh: outcome.ok ? String(outcome.totalKwh) : null,
      totalElectricityAmount: outcome.ok ? centimesToDecimalString(Math.round(outcome.totalElectricityAmount * 100)) : null,
      totalWaterAmount: outcome.ok ? centimesToDecimalString(Math.round(outcome.totalWaterAmount * 100)) : null,
      totalAmount: outcome.ok ? centimesToDecimalString(Math.round(outcome.totalAmount * 100)) : null,
      totalPayable: outcome.ok ? String(outcome.totalPayable) : null,
      effectivePricePerKwh: outcome.ok ? String(outcome.effectivePricePerKwh) : null,
      waterMode: config.water.mode,
      toleranceAr: String(toleranceAr),
      correctionOfId: official?.id ?? null,
      correctionReason: correctionReason ?? null,
      createdBy: user.id,
    })
    .returning();
  if (!created) throw new Error('Insertion de la répartition impossible');

  const replaced = existing.filter((a) => a.status === 'DRAFT' || a.status === 'CALCULATED');
  if (replaced.length > 0) {
    await tx
      .update(allocations)
      .set({ status: 'SUPERSEDED', supersededById: created.id, supersededAt: new Date() })
      .where(inArray(allocations.id, replaced.map((a) => a.id)));
  }

  if (outcome.ok) {
    await tx.insert(allocationItems).values(
      outcome.consumers.map((c, index) => ({
        allocationId: created.id,
        consumerId: c.consumerId,
        consumerName: c.name,
        sortOrder: index,
        configuredMethod: c.method,
        appliedMethod: c.appliedMethod,
        provenance: c.provenance,
        kwh: whToDecimalString(c.wh),
        ratio: c.ratio.toFixed(10),
        electricityAmount: centimesToDecimalString(c.centimes.electricity),
        waterAmount: centimesToDecimalString(c.centimes.water),
        totalAmount: centimesToDecimalString(c.centimes.total),
        payableAmount: String(c.payableAmount),
        readingStartId: c.measurement?.startReadingId ?? null,
        readingEndId: c.measurement?.endReadingId ?? null,
        measuredKwh: c.measurement ? String(c.measurement.measuredKwh) : null,
        measuredDays: c.measurement ? String(c.measurement.measuredDays) : null,
        weight: c.weight != null ? String(c.weight) : null,
        overrideReason: c.overrideReason ?? null,
      })),
    );
  }
  if (outcome.calculationDetails.length > 0) {
    await tx.insert(allocationCalculationSteps).values(
      outcome.calculationDetails.map((s) => ({
        allocationId: created.id,
        stepOrder: s.order,
        consumerId: s.consumerId ?? null,
        code: s.code,
        label: s.label,
        formula: s.formula ?? null,
        result: s.result ?? null,
      })),
    );
  }

  if (!official) {
    await tx
      .update(bills)
      .set({ calculationStatus: outcome.ok ? 'CALCULATED' : 'NOT_CALCULATED' })
      .where(eq(bills.id, bill.id));
  }
  await audit(tx, meta, {
    action: official ? 'allocation.correction' : 'allocation.create',
    entityType: 'allocation',
    entityId: created.id,
    buildingId: bill.buildingId,
    billId: bill.id,
    oldValue: official ? { allocationId: official.id, version: official.version, status: official.status } : null,
    newValue: { version, status: created.status, correctionReason: correctionReason ?? null, config },
  });
  return created;
}

/** Vérifie qu'une répartition calculée correspond toujours aux données actuelles avant de la valider. */
async function assertStillCurrent(db: DbOrTx, allocation: AllocationRow, bill: BillRow): Promise<void> {
  const snapshot = allocation.inputSnapshot as AllocationInput;
  const current = billInput(bill);
  const changed = (Object.keys(current) as (keyof typeof current)[]).filter((key) => (snapshot[key] ?? null) !== (current[key] ?? null));
  if (changed.length > 0) {
    throw conflict('La facture a été modifiée depuis ce calcul : relancez le calcul avant de valider.', { changed });
  }
  const points = snapshot.consumers.flatMap((c) => [c.readingStart, c.readingEnd].filter((p): p is ReadingPoint => Boolean(p?.id)).map((p) => ({ consumer: c.name, point: p })));
  if (points.length === 0) return;
  const rows = await db
    .select()
    .from(meterReadings)
    .where(and(inArray(meterReadings.id, points.map((p) => p.point.id as string)), isNull(meterReadings.deletedAt)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unvalidated = new Set<string>();
  for (const { consumer, point } of points) {
    const row = byId.get(point.id as string);
    if (!row || Number(row.normalizedValue) !== point.value || row.readingDate !== point.date || (row.readingTime ?? null) !== (point.time ?? null)) {
      throw conflict(`Un relevé utilisé pour ${consumer} a été modifié ou supprimé depuis ce calcul : relancez le calcul.`);
    }
    if (!row.validated) unvalidated.add(consumer);
  }
  if (unvalidated.size > 0) {
    throw conflict(`Relevés à valider avant de valider la répartition : ${[...unvalidated].join(', ')}.`);
  }
}

export async function validateAllocation(tx: Tx, allocation: AllocationRow, user: AuthUser, meta: RequestMeta): Promise<void> {
  if (allocation.status !== 'CALCULATED') {
    throw conflict(`Seule une répartition calculée sans erreur peut être validée (statut actuel : ${allocation.status}).`);
  }
  const bill = await getBillOrThrow(tx, allocation.billId);
  await assertStillCurrent(tx, allocation, bill);
  const [official] = await tx
    .select()
    .from(allocations)
    .where(and(eq(allocations.billId, bill.id), inArray(allocations.status, ['VALIDATED', 'LOCKED'])))
    .limit(1);
  if (official?.status === 'LOCKED' && !isSuperadmin(user)) {
    throw forbidden('Répartition verrouillée : seul le super-administrateur peut la remplacer');
  }
  if (official) {
    await tx
      .update(allocations)
      .set({ status: 'SUPERSEDED', supersededById: allocation.id, supersededAt: new Date() })
      .where(eq(allocations.id, official.id));
  }
  await tx.update(allocations).set({ status: 'VALIDATED', validatedBy: user.id, validatedAt: new Date() }).where(eq(allocations.id, allocation.id));
  await tx.update(bills).set({ calculationStatus: 'VALIDATED' }).where(eq(bills.id, bill.id));
  await audit(tx, meta, {
    action: 'allocation.validate',
    entityType: 'allocation',
    entityId: allocation.id,
    buildingId: bill.buildingId,
    billId: bill.id,
    oldValue: official ? { replacedAllocationId: official.id, version: official.version } : null,
    newValue: { version: allocation.version, status: 'VALIDATED' },
  });
}

export async function lockAllocation(tx: Tx, allocation: AllocationRow, user: AuthUser, meta: RequestMeta): Promise<void> {
  if (allocation.status !== 'VALIDATED') throw conflict('Seule une répartition validée peut être verrouillée.');
  const bill = await getBillOrThrow(tx, allocation.billId);
  await tx.update(allocations).set({ status: 'LOCKED', lockedBy: user.id, lockedAt: new Date() }).where(eq(allocations.id, allocation.id));
  await tx.update(bills).set({ calculationStatus: 'LOCKED' }).where(eq(bills.id, bill.id));
  await audit(tx, meta, {
    action: 'allocation.lock',
    entityType: 'allocation',
    entityId: allocation.id,
    buildingId: bill.buildingId,
    billId: bill.id,
    newValue: { version: allocation.version, status: 'LOCKED' },
  });
}

export async function allocationDetail(db: DbOrTx, allocation: AllocationRow): Promise<AllocationDetailDto> {
  const items = await db.select().from(allocationItems).where(eq(allocationItems.allocationId, allocation.id)).orderBy(asc(allocationItems.sortOrder));
  const steps = await db
    .select()
    .from(allocationCalculationSteps)
    .where(eq(allocationCalculationSteps.allocationId, allocation.id))
    .orderBy(asc(allocationCalculationSteps.stepOrder));
  const names = await userNames(db, [allocation.createdBy, allocation.validatedBy]);
  const parsedConfig = AllocationConfigSchema.safeParse(allocation.config);
  const readingIds = [...new Set(items.flatMap((i) => [i.readingStartId, i.readingEndId]).filter((id): id is string => Boolean(id)))];
  const usedReadings = readingIds.length
    ? await db
        .select({ reading: meterReadings, meterLabel: meters.label })
        .from(meterReadings)
        .innerJoin(meters, eq(meters.id, meterReadings.meterId))
        .where(inArray(meterReadings.id, readingIds))
    : [];
  return {
    ...toAllocationSummaryDto(allocation, names),
    totalElectricityAmount: num(allocation.totalElectricityAmount),
    totalWaterAmount: num(allocation.totalWaterAmount),
    effectivePricePerKwh: num(allocation.effectivePricePerKwh),
    toleranceAr: Number(allocation.toleranceAr),
    warnings: (allocation.warnings as AllocationIssue[]) ?? [],
    errors: (allocation.errors as AllocationIssue[]) ?? [],
    items: items.map(toAllocationItemDto),
    readings: usedReadings.map((r) => ({ ...toReadingDto(r.reading), meterLabel: r.meterLabel })),
    steps: steps.map((s) => ({
      order: s.stepOrder,
      code: s.code as AllocationDetailDto['steps'][number]['code'],
      ...(s.consumerId ? { consumerId: s.consumerId } : {}),
      label: s.label,
      ...(s.formula ? { formula: s.formula } : {}),
      ...(s.result ? { result: s.result } : {}),
    })),
    config: parsedConfig.success ? parsedConfig.data : { consumers: [], water: { mode: 'EQUAL' } },
    correctionOfId: allocation.correctionOfId,
    supersededById: allocation.supersededById,
  };
}

/**
 * Un relevé modifié ou supprimé rend « à recalculer » les factures qui l'utilisent.
 * Si une répartition verrouillée l'utilise, seul le super-administrateur peut le toucher.
 */
export async function flagBillsUsingReading(tx: Tx, readingId: string, user: AuthUser): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ billId: allocations.billId, status: allocations.status })
    .from(allocationItems)
    .innerJoin(allocations, eq(allocations.id, allocationItems.allocationId))
    .where(
      and(
        or(eq(allocationItems.readingStartId, readingId), eq(allocationItems.readingEndId, readingId)),
        inArray(allocations.status, ['CALCULATED', 'VALIDATED', 'LOCKED']),
      ),
    );
  if (rows.some((r) => r.status === 'LOCKED') && !isSuperadmin(user)) {
    throw forbidden('Ce relevé est utilisé par une répartition verrouillée : seul le super-administrateur peut le modifier');
  }
  const billIds = [...new Set(rows.map((r) => r.billId))];
  if (billIds.length > 0) {
    await tx.update(bills).set({ calculationStatus: 'OUTDATED' }).where(inArray(bills.id, billIds));
  }
  return billIds;
}
