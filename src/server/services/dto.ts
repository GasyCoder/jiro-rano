import type {
  AllocationItemDto,
  AllocationSummaryDto,
  BuildingDto,
  ConsumerDto,
  FileDto,
  MeterDto,
  ReadingDto,
  UserDto,
} from '@shared/api';
import type { Permission } from '@shared/domain';
import type { allocationItems, allocations, buildings, consumers, files, meterReadings, meters, users } from '../db/schema';

/** Conversion des lignes SQL en objets JSON de l'API (numeric → number, Date → ISO). */

export const num = (value: string | null): number | null => (value === null ? null : Number(value));
export const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

export function toUserDto(u: typeof users.$inferSelect): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    locale: u.locale === 'mg' ? 'mg' : 'fr',
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export function toBuildingDto(b: typeof buildings.$inferSelect, permissions: Permission[], mainMeterId: string | null): BuildingDto {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    description: b.description,
    jiramaClientNumber: b.jiramaClientNumber,
    jiramaMeterReference: b.jiramaMeterReference,
    managerName: b.managerName,
    active: b.active,
    defaultWaterMode: b.defaultWaterMode,
    roundingToleranceAr: Number(b.roundingToleranceAr),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    permissions,
    mainMeterId,
  };
}

export function toConsumerDto(c: typeof consumers.$inferSelect, hasHistory: boolean): ConsumerDto {
  return {
    id: c.id,
    buildingId: c.buildingId,
    name: c.name,
    description: c.description,
    order: c.sortOrder,
    active: c.active,
    type: c.type,
    hasSubMeter: c.meterId !== null,
    meterId: c.meterId,
    allocationMode: c.allocationMode,
    weight: Number(c.weight),
    waterWeight: Number(c.waterWeight),
    hasHistory,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toReadingDto(r: typeof meterReadings.$inferSelect): ReadingDto {
  return {
    id: r.id,
    meterId: r.meterId,
    readingDate: r.readingDate,
    readingTime: r.readingTime,
    value: Number(r.value),
    normalizedValue: Number(r.normalizedValue),
    source: r.source,
    photoFileId: r.photoFileId,
    photoUrl: r.photoFileId ? fileUrl(r.photoFileId) : null,
    confidenceScore: num(r.confidenceScore),
    validated: r.validated,
    validatedBy: r.validatedBy,
    validatedAt: iso(r.validatedAt),
    notes: r.notes,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toMeterDto(m: typeof meters.$inferSelect, consumerId: string | null, lastReading: ReadingDto | null): MeterDto {
  return {
    id: m.id,
    buildingId: m.buildingId,
    type: m.type,
    label: m.label,
    serialNumber: m.serialNumber,
    unit: m.unit === 'm3' ? 'm3' : 'kWh',
    normalization: m.normalization,
    rolloverAt: num(m.rolloverAt),
    active: m.active,
    notes: m.notes,
    consumerId,
    lastReading,
  };
}

export function toFileDto(f: typeof files.$inferSelect): FileDto {
  return {
    id: f.id,
    kind: f.kind,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    originalName: f.originalName,
    url: fileUrl(f.id),
    createdAt: f.createdAt.toISOString(),
  };
}

export function toAllocationSummaryDto(a: typeof allocations.$inferSelect, names: Map<string, string>): AllocationSummaryDto {
  return {
    id: a.id,
    billId: a.billId,
    version: a.version,
    status: a.status,
    engineVersion: a.engineVersion,
    totalKwh: num(a.totalKwh),
    totalAmount: num(a.totalAmount),
    totalPayable: num(a.totalPayable),
    waterMode: a.waterMode,
    warningsCount: Array.isArray(a.warnings) ? a.warnings.length : 0,
    errorsCount: Array.isArray(a.errors) ? a.errors.length : 0,
    correctionReason: a.correctionReason,
    createdAt: a.createdAt.toISOString(),
    createdByName: (a.createdBy && names.get(a.createdBy)) || null,
    validatedAt: iso(a.validatedAt),
    validatedByName: (a.validatedBy && names.get(a.validatedBy)) || null,
    lockedAt: iso(a.lockedAt),
  };
}

export function toAllocationItemDto(i: typeof allocationItems.$inferSelect): AllocationItemDto {
  return {
    id: i.id,
    consumerId: i.consumerId,
    consumerName: i.consumerName,
    order: i.sortOrder,
    configuredMethod: i.configuredMethod,
    appliedMethod: i.appliedMethod,
    provenance: i.provenance,
    kwh: Number(i.kwh),
    ratio: Number(i.ratio),
    electricityAmount: Number(i.electricityAmount),
    waterAmount: Number(i.waterAmount),
    totalAmount: Number(i.totalAmount),
    payableAmount: Number(i.payableAmount),
    readingStartId: i.readingStartId,
    readingEndId: i.readingEndId,
    measuredKwh: num(i.measuredKwh),
    measuredDays: num(i.measuredDays),
    weight: num(i.weight),
    overrideReason: i.overrideReason,
  };
}
