import type { AllocationMode, AppliedMethod, Provenance, WaterMode, WaterProportionalKey } from '../domain';

/** Un relevé de compteur déjà normalisé (ex. 4801 pour un affichage 48015 dont on ignore les dixièmes). */
export type ReadingPoint = {
  id?: string;
  value: number;
  /** Date calendaire AAAA-MM-JJ. */
  date: string;
  /** Heure locale HH:mm ou HH:mm:ss, si connue. */
  time?: string | null;
};

export type ConsumerAllocationInput = {
  id: string;
  name: string;
  method: AllocationMode;
  /** SUB_METER : relevés de début et de fin. */
  readingStart?: ReadingPoint | null;
  readingEnd?: ReadingPoint | null;
  /** Valeur à laquelle le compteur repasse à zéro (ex. 10000 pour 4 chiffres). */
  meterRolloverAt?: number | null;
  /** MANUAL_APPROXIMATION : kWh estimés par le gestionnaire (enregistrés comme ESTIMATED). */
  manualKwh?: number | null;
  /** WEIGHTED_SHARE : coefficient (> 0). */
  weight?: number | null;
  /** Eau PROPORTIONAL / WEIGHT : coefficient (≥ 0, défaut 1). */
  waterWeight?: number | null;
  /** Eau MANUAL : montant en Ariary. */
  manualWaterAmount?: number | null;
  /** Correction exceptionnelle d'un gestionnaire : remplace la valeur calculée (provenance MANUAL). */
  override?: { kwh: number; reason: string } | null;
};

export type WaterAllocationConfig =
  | { mode: 'EQUAL' }
  | { mode: 'PROPORTIONAL'; key: WaterProportionalKey }
  | { mode: 'MANUAL' };

/**
 * Entrée du moteur. Les dates sont des chaînes AAAA-MM-JJ (et non des Date) : les dates JIRAMA sont
 * calendaires, et une chaîne reste identique après sérialisation JSON — le calcul est reproductible.
 */
export type AllocationInput = {
  totalKwh: number;
  electricityAmount: number;
  waterAmount: number;
  /** Total de la facture (électricité + eau). Contrôlé s'il est fourni. */
  billTotalAmount?: number | null;
  periodStart: string;
  periodEnd: string;
  /** Nombre de jours indiqué par JIRAMA. Par défaut : différence entre les dates. */
  billDays?: number | null;
  mainMeterPreviousIndex?: number | null;
  mainMeterCurrentIndex?: number | null;
  water?: WaterAllocationConfig;
  /** Tolérance d'arrondi en Ariary (défaut 2). */
  toleranceAr?: number;
  consumers: ConsumerAllocationInput[];
};

export type IssueCode =
  // Erreurs bloquantes
  | 'NO_CONSUMERS'
  | 'DUPLICATE_CONSUMER'
  | 'INVALID_TOTAL_KWH'
  | 'INVALID_AMOUNT'
  | 'INVALID_PERIOD'
  | 'INVALID_TOLERANCE'
  | 'MISSING_READINGS'
  | 'INVALID_READING'
  | 'READINGS_ORDER'
  | 'NEGATIVE_CONSUMPTION'
  | 'INVALID_MANUAL_KWH'
  | 'INVALID_WEIGHT'
  | 'INVALID_OVERRIDE'
  | 'MULTIPLE_DIFFERENCE'
  | 'DIFFERENCE_WITH_SHARES'
  | 'SUBMETERS_EXCEED_MAIN'
  | 'UNALLOCATED_KWH'
  | 'WATER_WEIGHTS_ZERO'
  | 'INVALID_WATER_AMOUNT'
  | 'WATER_MANUAL_MISMATCH'
  | 'ELECTRICITY_MISMATCH'
  | 'TOTAL_MISMATCH'
  // Avertissements
  | 'BILL_DAYS_MISMATCH'
  | 'MAIN_METER_MISMATCH'
  | 'METER_ROLLOVER'
  | 'READING_TIME_MISSING'
  | 'SHORT_MEASUREMENT'
  | 'MEASUREMENT_OUTSIDE_PERIOD'
  | 'DIFFERENCE_ZERO'
  | 'ESTIMATED_VALUES'
  | 'MANUAL_OVERRIDE_USED'
  | 'WATER_MANUAL_ROUNDING'
  | 'TOTAL_ROUNDING'
  // Contrôle du service (hors moteur) : relevés pas encore validés par un gestionnaire
  | 'READING_NOT_VALIDATED';

export type AllocationIssue = {
  code: IssueCode;
  message: string;
  consumerId?: string;
  params?: Record<string, string | number>;
};

export type StepCode =
  | 'BILL_SUMMARY'
  | 'MAIN_METER'
  | 'SUB_METER_EXACT'
  | 'SUB_METER_MEASURED'
  | 'SUB_METER_PRORATED'
  | 'MANUAL_APPROXIMATION'
  | 'MANUAL_OVERRIDE'
  | 'REMAINDER'
  | 'DIFFERENCE'
  | 'EQUAL_SHARE'
  | 'WEIGHTED_SHARE'
  | 'KWH_CHECK'
  | 'EFFECTIVE_PRICE'
  | 'ELECTRICITY_SHARE'
  | 'ROUNDING'
  | 'WATER_SHARE'
  | 'CONSUMER_TOTAL'
  | 'TOTAL_CHECK';

/** Une étape lisible du calcul : « label : formula = result ». */
export type CalculationStep = {
  order: number;
  code: StepCode;
  consumerId?: string;
  label: string;
  formula?: string;
  result?: string;
};

export type MeasurementDetails = {
  startValue: number;
  endValue: number;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  measuredKwh: number;
  measuredDays: number;
  dailyKwh: number;
  rollover: boolean;
  startReadingId?: string;
  endReadingId?: string;
};

export type ConsumerAllocationResult = {
  consumerId: string;
  name: string;
  method: AllocationMode;
  appliedMethod: AppliedMethod;
  provenance: Provenance;
  /** Consommation attribuée, en Wh entiers (valeur exacte utilisée par le calcul). */
  wh: number;
  kwh: number;
  /** Part de la consommation totale (0 à 1). */
  ratio: number;
  electricityAmount: number;
  waterAmount: number;
  totalAmount: number;
  /** Montant à payer arrondi à l'Ariary (somme = total facture arrondi). */
  payableAmount: number;
  centimes: { electricity: number; water: number; total: number };
  measurement?: MeasurementDetails;
  weight?: number;
  overrideReason?: string;
};

export type AllocationResult = {
  ok: true;
  engineVersion: string;
  billDays: number;
  consumers: ConsumerAllocationResult[];
  totalKwh: number;
  totalElectricityAmount: number;
  totalWaterAmount: number;
  totalAmount: number;
  totalPayable: number;
  effectivePricePerKwh: number;
  waterMode: WaterMode;
  toleranceAr: number;
  warnings: AllocationIssue[];
  errors: [];
  calculationDetails: CalculationStep[];
};

export type AllocationFailure = {
  ok: false;
  engineVersion: string;
  errors: AllocationIssue[];
  warnings: AllocationIssue[];
  calculationDetails: CalculationStep[];
  /** Ce qui a pu être déterminé avant l'erreur (aide au diagnostic, jamais utilisé pour facturer). */
  partial: { consumerId: string; name: string; kwh: number | null; provenance: Provenance | null }[];
};

export type AllocationOutcome = AllocationResult | AllocationFailure;
