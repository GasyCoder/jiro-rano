import type { AllocationIssue, CalculationStep, ConsumerAllocationResult } from './billing/types';
import type {
  AllocationMode,
  AllocationStatus,
  AppliedMethod,
  BillStatus,
  BuildingRole,
  CalculationStatus,
  ConsumerType,
  FileKind,
  MeterType,
  Permission,
  Provenance,
  ReadingNormalization,
  ReadingSource,
  UserRole,
  WaterMode,
} from './domain';
import type { AllocationConfig, AppSettings } from './schemas';

/** Formes des réponses JSON de l'API (montants en Ariary, énergie en kWh, dates AAAA-MM-JJ). */

export type ApiError = {
  error: { code: string; message: string; issues?: { path: string; message: string }[]; details?: unknown };
};

export type UserDto = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  locale: 'fr' | 'mg';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type MembershipDto = {
  buildingId: string;
  buildingName: string;
  role: BuildingRole | 'SUPERADMIN';
  permissions: Permission[];
  consumerId: string | null;
};

export type MeDto = { user: UserDto; memberships: MembershipDto[] };

export type BuildingDto = {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  jiramaClientNumber: string | null;
  jiramaMeterReference: string | null;
  managerName: string | null;
  active: boolean;
  defaultWaterMode: WaterMode;
  roundingToleranceAr: number;
  createdAt: string;
  updatedAt: string;
  /** Permissions de l'utilisateur courant sur ce bâtiment. */
  permissions: Permission[];
  mainMeterId: string | null;
};

export type MemberDto = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: BuildingRole;
  permissions: Permission[];
  extraPermissions: Permission[];
  consumerId: string | null;
};

export type MeterDto = {
  id: string;
  buildingId: string;
  type: MeterType;
  label: string;
  serialNumber: string | null;
  unit: 'kWh' | 'm3';
  normalization: ReadingNormalization;
  rolloverAt: number | null;
  active: boolean;
  notes: string | null;
  consumerId: string | null;
  lastReading: ReadingDto | null;
};

export type ConsumerDto = {
  id: string;
  buildingId: string;
  name: string;
  description: string | null;
  order: number;
  active: boolean;
  type: ConsumerType;
  hasSubMeter: boolean;
  meterId: string | null;
  allocationMode: AllocationMode;
  weight: number;
  waterWeight: number;
  hasHistory: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReadingDto = {
  id: string;
  meterId: string;
  /** Libellé du compteur, fourni quand le relevé est listé hors du contexte de son compteur (rapport). */
  meterLabel?: string;
  readingDate: string;
  readingTime: string | null;
  value: number;
  normalizedValue: number;
  source: ReadingSource;
  photoFileId: string | null;
  photoUrl: string | null;
  confidenceScore: number | null;
  validated: boolean;
  validatedBy: string | null;
  validatedAt: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type FileDto = {
  id: string;
  kind: FileKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  url: string;
  createdAt: string;
};

export type ExtractedMeterReadingDto = {
  value?: number;
  date?: string;
  time?: string;
  confidence?: number;
  rawText?: string;
  warnings?: string[];
};

export type ExtractedBillDto = {
  periodStart?: string;
  periodEnd?: string;
  days?: number;
  previousIndex?: number;
  currentIndex?: number;
  electricityKwh?: number;
  electricityAmount?: number;
  waterAmount?: number;
  totalAmount?: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  confidence?: number;
  rawText?: string;
  warnings?: string[];
};

export type UploadResultDto = {
  file: FileDto;
  extractor: string;
  meterReading?: ExtractedMeterReadingDto;
  bill?: ExtractedBillDto;
  extractionError?: string;
};

export type BillDto = {
  id: string;
  buildingId: string;
  periodStart: string;
  periodEnd: string;
  days: number;
  mainMeterPreviousIndex: number | null;
  mainMeterCurrentIndex: number | null;
  electricityKwh: number;
  electricityAmount: number;
  waterAmount: number;
  totalAmount: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  notes: string | null;
  status: BillStatus;
  calculationStatus: CalculationStatus;
  createdAt: string;
  updatedAt: string;
  documents: FileDto[];
  /** Répartition officielle (validée ou verrouillée), sinon la plus récente. */
  currentAllocation: AllocationSummaryDto | null;
};

export type AllocationSummaryDto = {
  id: string;
  billId: string;
  version: number;
  status: AllocationStatus;
  engineVersion: string;
  totalKwh: number | null;
  totalAmount: number | null;
  totalPayable: number | null;
  waterMode: WaterMode;
  warningsCount: number;
  errorsCount: number;
  correctionReason: string | null;
  createdAt: string;
  createdByName: string | null;
  validatedAt: string | null;
  validatedByName: string | null;
  lockedAt: string | null;
};

export type AllocationItemDto = {
  id: string;
  consumerId: string;
  consumerName: string;
  order: number;
  configuredMethod: AllocationMode;
  appliedMethod: AppliedMethod;
  provenance: Provenance;
  kwh: number;
  ratio: number;
  electricityAmount: number;
  waterAmount: number;
  totalAmount: number;
  payableAmount: number;
  readingStartId: string | null;
  readingEndId: string | null;
  measuredKwh: number | null;
  measuredDays: number | null;
  weight: number | null;
  overrideReason: string | null;
};

export type AllocationDetailDto = AllocationSummaryDto & {
  totalElectricityAmount: number | null;
  totalWaterAmount: number | null;
  effectivePricePerKwh: number | null;
  toleranceAr: number;
  warnings: AllocationIssue[];
  errors: AllocationIssue[];
  items: AllocationItemDto[];
  /** Relevés de sous-compteur utilisés par cette répartition (traçabilité, rapport). */
  readings: ReadingDto[];
  steps: CalculationStep[];
  config: AllocationConfig;
  correctionOfId: string | null;
  supersededById: string | null;
};

export type SimulationDto =
  | ({ ok: true } & {
      consumers: ConsumerAllocationResult[];
      totalKwh: number;
      totalElectricityAmount: number;
      totalWaterAmount: number;
      totalAmount: number;
      totalPayable: number;
      effectivePricePerKwh: number;
      warnings: AllocationIssue[];
      errors: AllocationIssue[];
      calculationDetails: CalculationStep[];
    })
  | {
      ok: false;
      warnings: AllocationIssue[];
      errors: AllocationIssue[];
      calculationDetails: CalculationStep[];
      partial: { consumerId: string; name: string; kwh: number | null; provenance: Provenance | null }[];
    };

export type AllocationDraftConsumerDto = {
  consumer: ConsumerDto;
  meter: MeterDto | null;
  readings: ReadingDto[];
  suggestedStartId: string | null;
  suggestedEndId: string | null;
};

export type AllocationDraftDto = {
  bill: BillDto;
  consumers: AllocationDraftConsumerDto[];
  config: AllocationConfig;
  /** Peut-on appliquer une correction manuelle (override) ? */
  canOverride: boolean;
};

export type AuditLogDto = {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  buildingId: string | null;
  billId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  createdAt: string;
};

export type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number };

export type DashboardDto = {
  building: BuildingDto;
  consumersCount: number;
  latestBill: BillDto | null;
  previousBill: BillDto | null;
  latestAllocation: AllocationDetailDto | null;
  evolution: { kwhPercent: number | null; amountPercent: number | null };
  monthly: {
    billId: string;
    periodStart: string;
    periodEnd: string;
    totalKwh: number;
    totalAmount: number;
    perConsumer: { consumerId: string; name: string; kwh: number; totalAmount: number }[];
  }[];
};

export type SettingsDto = AppSettings & {
  extractorProvider: string;
  uploadMaxMb: number;
  version: string;
};
