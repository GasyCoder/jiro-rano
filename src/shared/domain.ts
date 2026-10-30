/**
 * Vocabulaire métier partagé entre le serveur, le client et la base de données.
 * Toute valeur ajoutée ici doit aussi exister dans les enums PostgreSQL (src/server/db/schema.ts).
 */

export const USER_ROLES = ['SUPERADMIN', 'USER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BUILDING_ROLES = ['MANAGER', 'CONTRIBUTOR', 'VIEWER'] as const;
export type BuildingRole = (typeof BUILDING_ROLES)[number];

export const PERMISSIONS = [
  'building.read',
  'building.update',
  'building.manage_members',
  'consumer.manage',
  'meter.manage',
  'bill.read',
  'bill.write',
  'reading.create',
  'reading.validate',
  'allocation.calculate',
  'allocation.validate',
  'allocation.lock',
  'report.share',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER_PERMISSIONS: readonly Permission[] = ['building.read', 'bill.read', 'report.share'];
const CONTRIBUTOR_PERMISSIONS: readonly Permission[] = [...VIEWER_PERMISSIONS, 'reading.create'];

/** Permissions accordées par rôle de bâtiment. Des permissions supplémentaires peuvent être données membre par membre. */
export const BUILDING_ROLE_PERMISSIONS: Record<BuildingRole, readonly Permission[]> = {
  VIEWER: VIEWER_PERMISSIONS,
  CONTRIBUTOR: CONTRIBUTOR_PERMISSIONS,
  MANAGER: PERMISSIONS,
};

export function permissionsForMember(role: BuildingRole, extra: readonly string[] = []): Permission[] {
  const granted = new Set<Permission>(BUILDING_ROLE_PERMISSIONS[role]);
  for (const p of extra) {
    if ((PERMISSIONS as readonly string[]).includes(p)) granted.add(p as Permission);
  }
  return PERMISSIONS.filter((p) => granted.has(p));
}

export const CONSUMER_TYPES = ['FLOOR', 'APARTMENT', 'STUDIO', 'SHOP', 'GARAGE', 'ANNEX', 'COMMON', 'OTHER'] as const;
export type ConsumerType = (typeof CONSUMER_TYPES)[number];

/** Méthode configurée pour un consommateur. */
export const ALLOCATION_MODES = ['SUB_METER', 'DIFFERENCE', 'EQUAL_SHARE', 'WEIGHTED_SHARE', 'MANUAL_APPROXIMATION'] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

/** Méthode réellement appliquée par le moteur (SUB_METER devient EXACT ou PRORATED selon les dates). */
export const APPLIED_METHODS = [
  'SUB_METER_EXACT',
  'SUB_METER_PRORATED',
  'DIFFERENCE',
  'EQUAL_SHARE',
  'WEIGHTED_SHARE',
  'MANUAL_APPROXIMATION',
  'MANUAL_OVERRIDE',
] as const;
export type AppliedMethod = (typeof APPLIED_METHODS)[number];

/**
 * Provenance d'une valeur de consommation. Conservée en base et dans l'audit :
 * l'application ne présente jamais une estimation comme une mesure.
 */
export const PROVENANCES = ['MEASURED', 'PRORATED', 'ESTIMATED', 'MANUAL', 'DIFFERENCE'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const METER_TYPES = ['MAIN', 'SUB_METER', 'WATER', 'COMMON'] as const;
export type MeterType = (typeof METER_TYPES)[number];

export const READING_SOURCES = ['MANUAL', 'IMAGE', 'OCR', 'IMPORT'] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

/** Règle de normalisation d'un index : INTEGER_TRUNCATE ignore les dixièmes (tambour rouge). */
export const READING_NORMALIZATIONS = ['INTEGER_TRUNCATE', 'AS_IS'] as const;
export type ReadingNormalization = (typeof READING_NORMALIZATIONS)[number];

export const BILL_STATUSES = ['DRAFT', 'CONFIRMED', 'ARCHIVED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const CALCULATION_STATUSES = ['NOT_CALCULATED', 'CALCULATED', 'VALIDATED', 'LOCKED', 'OUTDATED'] as const;
export type CalculationStatus = (typeof CALCULATION_STATUSES)[number];

export const ALLOCATION_STATUSES = ['DRAFT', 'CALCULATED', 'VALIDATED', 'LOCKED', 'SUPERSEDED'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const WATER_MODES = ['EQUAL', 'PROPORTIONAL', 'MANUAL'] as const;
export type WaterMode = (typeof WATER_MODES)[number];

export const WATER_PROPORTIONAL_KEYS = ['KWH', 'WEIGHT'] as const;
export type WaterProportionalKey = (typeof WATER_PROPORTIONAL_KEYS)[number];

export const FILE_KINDS = ['METER_PHOTO', 'BILL_PHOTO', 'BILL_PDF', 'OTHER'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export function normalizeReading(value: number, rule: ReadingNormalization): number {
  return rule === 'INTEGER_TRUNCATE' ? Math.floor(value) : value;
}
