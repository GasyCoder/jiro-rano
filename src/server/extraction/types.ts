/**
 * Lecture automatique des photos. La logique métier ne dépend que de ces interfaces : on peut brancher
 * un moteur de vision IA, un OCR, ou rien du tout (saisie manuelle) sans toucher au reste.
 * Une valeur extraite n'est JAMAIS enregistrée sans confirmation humaine.
 */

export type ExtractedMeterReading = {
  value?: number;
  /** AAAA-MM-JJ */
  date?: string;
  /** HH:mm[:ss] */
  time?: string;
  /** 0 à 1 */
  confidence?: number;
  rawText?: string;
  /** Points à vérifier par l'humain (chiffre en rotation, année supposée…). */
  warnings?: string[];
};

export interface MeterReadingExtractor {
  readonly name: string;
  extract(file: Buffer, mimeType?: string): Promise<ExtractedMeterReading>;
}

export type ExtractedBill = {
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

export interface BillExtractor {
  readonly name: string;
  extract(file: Buffer, mimeType?: string): Promise<ExtractedBill>;
}

export class ExtractionError extends Error {}
