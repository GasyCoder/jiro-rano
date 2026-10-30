import { z } from 'zod';
import { isValidDate, toEpochSeconds } from './billing/dates';
import {
  ALLOCATION_MODES,
  BILL_STATUSES,
  BUILDING_ROLES,
  CONSUMER_TYPES,
  FILE_KINDS,
  METER_TYPES,
  PERMISSIONS,
  READING_NORMALIZATIONS,
  READING_SOURCES,
  USER_ROLES,
  WATER_MODES,
  WATER_PROPORTIONAL_KEYS,
} from './domain';

/**
 * Schémas de validation des requêtes. Partagés : le client valide les formulaires avec les mêmes
 * règles que le serveur, qui reste seul juge (toute requête est revalidée côté serveur).
 */

export const uuid = z.uuid();
export const dateString = z.string().refine(isValidDate, 'Date invalide (AAAA-MM-JJ)');
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Heure invalide (HH:mm)');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const amount = z.number().finite().min(0).max(1e12);
const kwhValue = z.number().finite().min(0).max(1e9);
const password = z.string().min(10, 'Au moins 10 caractères').max(200);

export const LoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const UserCreateSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(USER_ROLES).default('USER'),
  password,
  locale: z.enum(['fr', 'mg']).default('fr'),
});

export const UserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  locale: z.enum(['fr', 'mg']).optional(),
});

export const ResetPasswordSchema = z.object({ password });

export const BuildingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: optionalText(300),
  description: optionalText(2000),
  jiramaClientNumber: optionalText(60),
  jiramaMeterReference: optionalText(60),
  managerName: optionalText(120),
  active: z.boolean().optional(),
  defaultWaterMode: z.enum(WATER_MODES).optional(),
  roundingToleranceAr: z.number().min(0).max(1000).optional(),
});
export const BuildingUpdateSchema = BuildingSchema.partial();

/** Ajout d'un membre par e-mail : un gestionnaire n'a pas accès à l'annuaire des comptes. */
export const MemberSchema = z.object({
  email: z.email().max(254),
  role: z.enum(BUILDING_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
  consumerId: uuid.nullable().optional(),
});

export const MemberUpdateSchema = z.object({
  role: z.enum(BUILDING_ROLES).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).optional(),
  consumerId: uuid.nullable().optional(),
});

export const ConsumerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(500),
  type: z.enum(CONSUMER_TYPES).default('FLOOR'),
  active: z.boolean().optional(),
  meterId: uuid.nullable().optional(),
  allocationMode: z.enum(ALLOCATION_MODES).default('DIFFERENCE'),
  weight: z.number().positive().max(1000).default(1),
  waterWeight: z.number().min(0).max(1000).default(1),
});
export const ConsumerUpdateSchema = ConsumerSchema.partial();

export const ReorderSchema = z.object({ ids: z.array(uuid).min(1).max(200) });

export const MeterSchema = z.object({
  type: z.enum(METER_TYPES),
  label: z.string().trim().min(1).max(80),
  serialNumber: optionalText(80),
  unit: z.enum(['kWh', 'm3']).default('kWh'),
  normalization: z.enum(READING_NORMALIZATIONS).default('INTEGER_TRUNCATE'),
  rolloverAt: z.number().positive().max(1e9).nullable().optional(),
  active: z.boolean().optional(),
  notes: optionalText(1000),
});
export const MeterUpdateSchema = MeterSchema.partial();

/** Toute valeur enregistrée doit avoir été confirmée par un humain, y compris une valeur lue sur photo. */
export const ReadingCreateSchema = z.object({
  readingDate: dateString,
  readingTime: timeString.nullable().optional(),
  value: kwhValue,
  source: z.enum(READING_SOURCES).default('MANUAL'),
  photoFileId: uuid.nullable().optional(),
  confidenceScore: z.number().min(0).max(1).nullable().optional(),
  extracted: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: optionalText(1000),
  confirmed: z.literal(true, { error: 'La valeur doit être confirmée par un humain' }),
});

export const ReadingUpdateSchema = z.object({
  readingDate: dateString.optional(),
  readingTime: timeString.nullable().optional(),
  value: kwhValue.optional(),
  notes: optionalText(1000),
  reason: z.string().trim().min(3, 'Indiquez la raison de la modification').max(500),
});

export const DeleteWithReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Indiquez la raison').max(500),
});

const billFields = {
  periodStart: dateString,
  periodEnd: dateString,
  days: z.number().int().positive().max(400),
  mainMeterPreviousIndex: kwhValue.nullable().optional(),
  mainMeterCurrentIndex: kwhValue.nullable().optional(),
  electricityKwh: z.number().finite().positive().max(1e9),
  electricityAmount: amount,
  waterAmount: amount.default(0),
  totalAmount: amount,
  invoiceNumber: optionalText(60),
  invoiceDate: dateString.nullable().optional(),
  dueDate: dateString.nullable().optional(),
  notes: optionalText(2000),
  status: z.enum(BILL_STATUSES).optional(),
  extracted: z.record(z.string(), z.unknown()).nullable().optional(),
  documentFileIds: z.array(uuid).max(10).optional(),
};

const periodIsOrdered = (v: { periodStart?: string; periodEnd?: string }) =>
  !v.periodStart || !v.periodEnd || toEpochSeconds(v.periodEnd) > toEpochSeconds(v.periodStart);

export const BillSchema = z.object(billFields).refine(periodIsOrdered, {
  message: 'La fin de période doit être postérieure au début',
  path: ['periodEnd'],
});

export const BillUpdateSchema = z
  .object(billFields)
  .partial()
  .extend({ reason: z.string().trim().max(500).optional() })
  .refine(periodIsOrdered, { message: 'La fin de période doit être postérieure au début', path: ['periodEnd'] });

export const WaterConfigSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('EQUAL') }),
  z.object({ mode: z.literal('PROPORTIONAL'), key: z.enum(WATER_PROPORTIONAL_KEYS) }),
  z.object({ mode: z.literal('MANUAL') }),
]);

export const AllocationConsumerConfigSchema = z.object({
  consumerId: uuid,
  method: z.enum(ALLOCATION_MODES),
  readingStartId: uuid.nullable().optional(),
  readingEndId: uuid.nullable().optional(),
  manualKwh: kwhValue.nullable().optional(),
  weight: z.number().positive().max(1000).nullable().optional(),
  waterWeight: z.number().min(0).max(1000).nullable().optional(),
  manualWaterAmount: amount.nullable().optional(),
  override: z
    .object({ kwh: kwhValue, reason: z.string().trim().min(3, 'Justification obligatoire').max(500) })
    .nullable()
    .optional(),
});

export const AllocationConfigSchema = z.object({
  consumers: z.array(AllocationConsumerConfigSchema).min(1).max(200),
  water: WaterConfigSchema.default({ mode: 'EQUAL' }),
  toleranceAr: z.number().min(0).max(1000).optional(),
});

export const AllocationCreateSchema = AllocationConfigSchema.extend({
  correctionReason: z.string().trim().min(3).max(1000).optional(),
});

export const FileKindQuerySchema = z.object({ kind: z.enum(FILE_KINDS).default('METER_PHOTO') });

export const AuditQuerySchema = z.object({
  buildingId: uuid.optional(),
  billId: uuid.optional(),
  entityType: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const SettingsSchema = z.object({
  defaultToleranceAr: z.number().min(0).max(1000),
  defaultWaterMode: z.enum(WATER_MODES),
  /** Les gestionnaires (non SUPERADMIN) peuvent-ils appliquer une correction manuelle ? */
  managersCanOverride: z.boolean(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type UserCreateInput = z.infer<typeof UserCreateSchema>;
export type BuildingInput = z.infer<typeof BuildingSchema>;
export type MemberInput = z.infer<typeof MemberSchema>;
export type ConsumerInput = z.infer<typeof ConsumerSchema>;
export type MeterInput = z.infer<typeof MeterSchema>;
export type ReadingCreateInput = z.infer<typeof ReadingCreateSchema>;
export type BillInput = z.infer<typeof BillSchema>;
export type AllocationConfig = z.infer<typeof AllocationConfigSchema>;
export type AllocationConsumerConfig = z.infer<typeof AllocationConsumerConfigSchema>;
export type AllocationCreateInput = z.infer<typeof AllocationCreateSchema>;
export type AppSettings = z.infer<typeof SettingsSchema>;
