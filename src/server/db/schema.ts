import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// Imports relatifs (pas d'alias) : drizzle-kit charge ce fichier sans la configuration Vite.
import {
  ALLOCATION_MODES,
  ALLOCATION_STATUSES,
  APPLIED_METHODS,
  BILL_STATUSES,
  BUILDING_ROLES,
  CALCULATION_STATUSES,
  CONSUMER_TYPES,
  FILE_KINDS,
  METER_TYPES,
  PROVENANCES,
  READING_NORMALIZATIONS,
  READING_SOURCES,
  USER_ROLES,
  WATER_MODES,
} from '../../shared/domain';

export const userRole = pgEnum('user_role', USER_ROLES);
export const buildingRole = pgEnum('building_role', BUILDING_ROLES);
export const consumerType = pgEnum('consumer_type', CONSUMER_TYPES);
export const allocationMode = pgEnum('allocation_mode', ALLOCATION_MODES);
export const appliedMethod = pgEnum('applied_method', APPLIED_METHODS);
export const provenance = pgEnum('provenance', PROVENANCES);
export const meterType = pgEnum('meter_type', METER_TYPES);
export const readingSource = pgEnum('reading_source', READING_SOURCES);
export const readingNormalization = pgEnum('reading_normalization', READING_NORMALIZATIONS);
export const billStatus = pgEnum('bill_status', BILL_STATUSES);
export const calculationStatus = pgEnum('calculation_status', CALCULATION_STATUSES);
export const allocationStatus = pgEnum('allocation_status', ALLOCATION_STATUSES);
export const waterMode = pgEnum('water_mode', WATER_MODES);
export const fileKind = pgEnum('file_kind', FILE_KINDS);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
/** Énergie en kWh (3 décimales = Wh exacts). */
const kwh = (name: string) => numeric(name, { precision: 14, scale: 3 });
/** Montant en Ariary (2 décimales = centimes exacts). */
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

// ---------------------------------------------------------------------------
// Utilisateurs, sessions, paramètres

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('USER'),
    active: boolean('active').notNull().default(true),
    locale: text('locale').notNull().default('fr'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`).where(sql`${t.deletedAt} is null`),
    check('users_locale_check', sql`${t.locale} in ('fr', 'mg')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 du jeton : le jeton lui-même n'est jamais stocké. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Bâtiments et membres

export const buildings = pgTable(
  'buildings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    address: text('address'),
    description: text('description'),
    jiramaClientNumber: text('jirama_client_number'),
    jiramaMeterReference: text('jirama_meter_reference'),
    managerName: text('manager_name'),
    active: boolean('active').notNull().default(true),
    defaultWaterMode: waterMode('default_water_mode').notNull().default('EQUAL'),
    roundingToleranceAr: numeric('rounding_tolerance_ar', { precision: 10, scale: 2 }).notNull().default('2'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [check('buildings_tolerance_check', sql`${t.roundingToleranceAr} >= 0`)],
);

export const buildingMembers = pgTable(
  'building_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: buildingRole('role').notNull().default('VIEWER'),
    /** Permissions accordées en plus de celles du rôle. */
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    /** Consommateur occupé par ce membre (locataire), le cas échéant. */
    consumerId: uuid('consumer_id').references((): AnyPgColumn => consumers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('building_members_unique').on(t.buildingId, t.userId), index('building_members_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Compteurs, consommateurs, relevés

export const meters = pgTable(
  'meters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'restrict' }),
    type: meterType('type').notNull(),
    label: text('label').notNull(),
    serialNumber: text('serial_number'),
    unit: text('unit').notNull().default('kWh'),
    normalization: readingNormalization('normalization').notNull().default('INTEGER_TRUNCATE'),
    /** Capacité du compteur (ex. 10000 pour 4 chiffres) : permet de gérer le passage par zéro. */
    rolloverAt: numeric('rollover_at', { precision: 14, scale: 3 }),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('meters_building_idx').on(t.buildingId),
    uniqueIndex('meters_one_main_per_building')
      .on(t.buildingId)
      .where(sql`${t.type} = 'MAIN' and ${t.deletedAt} is null`),
    check('meters_unit_check', sql`${t.unit} in ('kWh', 'm3')`),
    check('meters_rollover_check', sql`${t.rolloverAt} is null or ${t.rolloverAt} > 0`),
  ],
);

export const consumers = pgTable(
  'consumers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    type: consumerType('type').notNull().default('FLOOR'),
    meterId: uuid('meter_id').references(() => meters.id, { onDelete: 'set null' }),
    /** Dérivé de meter_id : ne peut jamais être incohérent. */
    hasSubMeter: boolean('has_sub_meter').generatedAlwaysAs(sql`meter_id is not null`),
    allocationMode: allocationMode('allocation_mode').notNull().default('DIFFERENCE'),
    weight: numeric('weight', { precision: 10, scale: 4 }).notNull().default('1'),
    waterWeight: numeric('water_weight', { precision: 10, scale: 4 }).notNull().default('1'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('consumers_building_idx').on(t.buildingId, t.sortOrder),
    uniqueIndex('consumers_meter_unique')
      .on(t.meterId)
      .where(sql`${t.meterId} is not null and ${t.deletedAt} is null`),
    check('consumers_weight_check', sql`${t.weight} > 0`),
    check('consumers_water_weight_check', sql`${t.waterWeight} >= 0`),
    check('consumers_sub_meter_check', sql`${t.allocationMode} <> 'SUB_METER' or ${t.meterId} is not null`),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'restrict' }),
    kind: fileKind('kind').notNull(),
    /** Clé aléatoire dans le stockage : jamais dérivée du nom d'origine. */
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    originalName: text('original_name'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('files_storage_key_unique').on(t.storageKey), index('files_building_idx').on(t.buildingId)],
);

export const meterReadings = pgTable(
  'meter_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meterId: uuid('meter_id')
      .notNull()
      .references(() => meters.id, { onDelete: 'restrict' }),
    readingDate: date('reading_date', { mode: 'string' }).notNull(),
    readingTime: time('reading_time'),
    /** Valeur lue telle qu'affichée (ex. 4801.5). */
    value: numeric('value', { precision: 14, scale: 3 }).notNull(),
    /** Valeur utilisée par les calculs après normalisation (ex. 4801). */
    normalizedValue: numeric('normalized_value', { precision: 14, scale: 3 }).notNull(),
    source: readingSource('source').notNull().default('MANUAL'),
    photoFileId: uuid('photo_file_id').references(() => files.id, { onDelete: 'set null' }),
    confidenceScore: numeric('confidence_score', { precision: 4, scale: 3 }),
    /** Résultat brut de la lecture automatique, conservé pour l'audit. */
    extracted: jsonb('extracted'),
    validated: boolean('validated').notNull().default(false),
    validatedBy: uuid('validated_by').references(() => users.id, { onDelete: 'set null' }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('meter_readings_meter_date_idx').on(t.meterId, t.readingDate),
    check('meter_readings_value_check', sql`${t.value} >= 0 and ${t.normalizedValue} >= 0`),
    check('meter_readings_confidence_check', sql`${t.confidenceScore} is null or (${t.confidenceScore} between 0 and 1)`),
  ],
);

// ---------------------------------------------------------------------------
// Factures

export const bills = pgTable(
  'bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'restrict' }),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    days: integer('days').notNull(),
    mainMeterPreviousIndex: kwh('main_meter_previous_index'),
    mainMeterCurrentIndex: kwh('main_meter_current_index'),
    electricityKwh: kwh('electricity_kwh').notNull(),
    electricityAmount: money('electricity_amount').notNull(),
    waterAmount: money('water_amount').notNull().default('0'),
    totalAmount: money('total_amount').notNull(),
    invoiceNumber: text('invoice_number'),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    notes: text('notes'),
    status: billStatus('status').notNull().default('DRAFT'),
    calculationStatus: calculationStatus('calculation_status').notNull().default('NOT_CALCULATED'),
    extracted: jsonb('extracted'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('bills_building_period_idx').on(t.buildingId, t.periodStart),
    uniqueIndex('bills_invoice_number_unique')
      .on(t.buildingId, t.invoiceNumber)
      .where(sql`${t.invoiceNumber} is not null and ${t.deletedAt} is null`),
    check('bills_period_check', sql`${t.periodEnd} > ${t.periodStart}`),
    check('bills_days_check', sql`${t.days} > 0`),
    check('bills_kwh_check', sql`${t.electricityKwh} > 0`),
    check('bills_amounts_check', sql`${t.electricityAmount} >= 0 and ${t.waterAmount} >= 0 and ${t.totalAmount} >= 0`),
  ],
);

export const billDocuments = pgTable(
  'bill_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    kind: fileKind('kind').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('bill_documents_unique').on(t.billId, t.fileId)],
);

// ---------------------------------------------------------------------------
// Répartitions (versionnées, jamais écrasées)

export const allocations = pgTable(
  'allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    status: allocationStatus('status').notNull(),
    engineVersion: text('engine_version').notNull(),
    /** Entrée exacte du moteur : permet de rejouer le calcul à l'identique. */
    inputSnapshot: jsonb('input_snapshot').notNull(),
    /** Configuration demandée (méthodes, relevés choisis, eau). */
    config: jsonb('config').notNull(),
    warnings: jsonb('warnings').notNull().default(sql`'[]'::jsonb`),
    errors: jsonb('errors').notNull().default(sql`'[]'::jsonb`),
    totalKwh: kwh('total_kwh'),
    totalElectricityAmount: money('total_electricity_amount'),
    totalWaterAmount: money('total_water_amount'),
    totalAmount: money('total_amount'),
    totalPayable: numeric('total_payable', { precision: 14, scale: 0 }),
    effectivePricePerKwh: numeric('effective_price_per_kwh', { precision: 14, scale: 4 }),
    waterMode: waterMode('water_mode').notNull(),
    toleranceAr: numeric('tolerance_ar', { precision: 10, scale: 2 }).notNull(),
    correctionOfId: uuid('correction_of_id').references((): AnyPgColumn => allocations.id, { onDelete: 'set null' }),
    correctionReason: text('correction_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    validatedBy: uuid('validated_by').references(() => users.id, { onDelete: 'set null' }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    supersededById: uuid('superseded_by_id').references((): AnyPgColumn => allocations.id, { onDelete: 'set null' }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('allocations_bill_version_unique').on(t.billId, t.version),
    /** Une seule répartition officielle (validée ou verrouillée) par facture. */
    uniqueIndex('allocations_one_official_per_bill')
      .on(t.billId)
      .where(sql`${t.status} in ('VALIDATED', 'LOCKED')`),
    check('allocations_version_check', sql`${t.version} > 0`),
  ],
);

export const allocationItems = pgTable(
  'allocation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id, { onDelete: 'cascade' }),
    consumerId: uuid('consumer_id')
      .notNull()
      .references(() => consumers.id, { onDelete: 'restrict' }),
    /** Nom au moment du calcul : l'historique reste lisible si le consommateur est renommé. */
    consumerName: text('consumer_name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    configuredMethod: allocationMode('configured_method').notNull(),
    appliedMethod: appliedMethod('applied_method').notNull(),
    provenance: provenance('provenance').notNull(),
    kwh: kwh('kwh').notNull(),
    ratio: numeric('ratio', { precision: 12, scale: 10 }).notNull(),
    electricityAmount: money('electricity_amount').notNull(),
    waterAmount: money('water_amount').notNull(),
    totalAmount: money('total_amount').notNull(),
    payableAmount: numeric('payable_amount', { precision: 14, scale: 0 }).notNull(),
    readingStartId: uuid('reading_start_id').references(() => meterReadings.id, { onDelete: 'set null' }),
    readingEndId: uuid('reading_end_id').references(() => meterReadings.id, { onDelete: 'set null' }),
    measuredKwh: kwh('measured_kwh'),
    measuredDays: numeric('measured_days', { precision: 10, scale: 4 }),
    weight: numeric('weight', { precision: 10, scale: 4 }),
    overrideReason: text('override_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('allocation_items_unique').on(t.allocationId, t.consumerId),
    index('allocation_items_readings_idx').on(t.readingStartId, t.readingEndId),
    check('allocation_items_kwh_check', sql`${t.kwh} >= 0`),
  ],
);

export const allocationCalculationSteps = pgTable(
  'allocation_calculation_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    consumerId: uuid('consumer_id').references(() => consumers.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    formula: text('formula'),
    result: text('result'),
  },
  (t) => [uniqueIndex('allocation_steps_order_unique').on(t.allocationId, t.stepOrder)],
);

// ---------------------------------------------------------------------------
// Audit

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    billId: uuid('bill_id').references(() => bills.id, { onDelete: 'set null' }),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_building_idx').on(t.buildingId, t.createdAt),
    index('audit_logs_bill_idx').on(t.billId),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);
