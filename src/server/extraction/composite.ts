import type { BillExtractor, ExtractedBill, ExtractedMeterReading, MeterReadingExtractor } from './types';

/**
 * Combine plusieurs extracteurs : l'index vient du premier qui en trouve un ; la date/heure EXIF
 * (heure réelle de prise de vue) est préférée à une date lue dans l'image.
 */
export class CompositeMeterExtractor implements MeterReadingExtractor {
  readonly name: string;

  constructor(
    private readonly valueExtractors: MeterReadingExtractor[],
    private readonly dateExtractor: MeterReadingExtractor | null,
  ) {
    this.name = [dateExtractor?.name, ...valueExtractors.map((e) => e.name)].filter(Boolean).join('+') || 'manual';
  }

  async extract(file: Buffer, mimeType?: string): Promise<ExtractedMeterReading> {
    const exif = this.dateExtractor ? await this.dateExtractor.extract(file, mimeType) : {};
    let result: ExtractedMeterReading = {};
    for (const extractor of this.valueExtractors) {
      result = await extractor.extract(file, mimeType);
      if (result.value !== undefined) break;
    }
    const warnings = [...(result.warnings ?? [])];
    if (exif.date) {
      if (result.date && result.date !== exif.date) {
        warnings.push(`Date lue sur l'image (${result.date}) différente de la date de prise de vue EXIF (${exif.date}) : la date EXIF est proposée.`);
      }
      return { ...result, date: exif.date, ...(exif.time ? { time: exif.time } : {}), warnings };
    }
    return { ...result, ...(warnings.length ? { warnings } : {}) };
  }
}

/** Aucun moteur configuré : la saisie reste manuelle. */
export class NoopBillExtractor implements BillExtractor {
  readonly name = 'manual';

  async extract(): Promise<ExtractedBill> {
    return {};
  }
}

/** Contrôles de cohérence appliqués à toute facture lue automatiquement. */
export function billConsistencyWarnings(bill: ExtractedBill): string[] {
  const warnings: string[] = [];
  if (bill.previousIndex !== undefined && bill.currentIndex !== undefined && bill.electricityKwh !== undefined) {
    const diff = Math.round((bill.currentIndex - bill.previousIndex) * 1000) / 1000;
    if (diff !== bill.electricityKwh) {
      warnings.push(
        `Les index (${bill.currentIndex} − ${bill.previousIndex} = ${diff} kWh) ne correspondent pas à la consommation facturée (${bill.electricityKwh} kWh). Vérifiez sur la facture papier.`,
      );
    }
  }
  if (bill.electricityAmount !== undefined && bill.waterAmount !== undefined && bill.totalAmount !== undefined) {
    const diff = Math.round((bill.electricityAmount + bill.waterAmount - bill.totalAmount) * 100) / 100;
    if (Math.abs(diff) > 0.01) {
      warnings.push(`Électricité + eau (${bill.electricityAmount + bill.waterAmount}) ≠ total (${bill.totalAmount}).`);
    }
  }
  return warnings;
}
