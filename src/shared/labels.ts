import type { AllocationMode, AllocationStatus, AppliedMethod, CalculationStatus, ConsumerType, MeterType, Provenance, ReadingSource } from './domain';

/** Libellés français partagés (badges, messages générés). Le client peut les surcharger par langue. */

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  MEASURED: 'Mesuré',
  PRORATED: 'Proratisé',
  ESTIMATED: 'Estimé',
  MANUAL: 'Manuel',
  DIFFERENCE: 'Calculé',
};

export const PROVENANCE_DESCRIPTIONS: Record<Provenance, string> = {
  MEASURED: 'Relevé réel du sous-compteur aux dates de la facture',
  PRORATED: 'Relevé réel ramené à la période de la facture',
  ESTIMATED: 'Valeur estimée, non issue d’un relevé',
  MANUAL: 'Correction manuelle justifiée par le gestionnaire',
  DIFFERENCE: 'Compteur principal moins les autres consommateurs',
};

export const ALLOCATION_MODE_LABELS: Record<AllocationMode, string> = {
  SUB_METER: 'Sous-compteur',
  DIFFERENCE: 'Par différence',
  EQUAL_SHARE: 'Part égale',
  WEIGHTED_SHARE: 'Part pondérée',
  MANUAL_APPROXIMATION: 'Estimation manuelle',
};

export const APPLIED_METHOD_LABELS: Record<AppliedMethod, string> = {
  SUB_METER_EXACT: 'Sous-compteur (dates exactes)',
  SUB_METER_PRORATED: 'Sous-compteur proratisé',
  DIFFERENCE: 'Par différence',
  EQUAL_SHARE: 'Part égale',
  WEIGHTED_SHARE: 'Part pondérée',
  MANUAL_APPROXIMATION: 'Estimation manuelle',
  MANUAL_OVERRIDE: 'Correction manuelle',
};

export const CONSUMER_TYPE_LABELS: Record<ConsumerType, string> = {
  FLOOR: 'Étage',
  APARTMENT: 'Appartement',
  STUDIO: 'Studio',
  SHOP: 'Boutique',
  GARAGE: 'Garage',
  ANNEX: 'Maison annexe',
  COMMON: 'Parties communes',
  OTHER: 'Autre',
};

export const METER_TYPE_LABELS: Record<MeterType, string> = {
  MAIN: 'Compteur principal JIRAMA',
  SUB_METER: 'Sous-compteur',
  WATER: 'Compteur d’eau',
  COMMON: 'Compteur commun',
};

export const READING_SOURCE_LABELS: Record<ReadingSource, string> = {
  MANUAL: 'Saisie manuelle',
  IMAGE: 'Photo',
  OCR: 'Lecture automatique confirmée',
  IMPORT: 'Import',
};

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  DRAFT: 'Brouillon',
  CALCULATED: 'Calculée',
  VALIDATED: 'Validée',
  LOCKED: 'Verrouillée',
  SUPERSEDED: 'Remplacée',
};

export const CALCULATION_STATUS_LABELS: Record<CalculationStatus, string> = {
  NOT_CALCULATED: 'Non calculée',
  CALCULATED: 'Calculée',
  VALIDATED: 'Validée',
  LOCKED: 'Verrouillée',
  OUTDATED: 'À recalculer',
};
