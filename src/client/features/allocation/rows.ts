import type { AllocationItemDto, ReadingDto } from '@shared/api';
import type { ConsumerAllocationResult } from '@shared/billing/types';
import type { AppliedMethod, Provenance } from '@shared/domain';
import { formatDateTimeFr, formatIndex } from '@/lib/format';

/** Ligne de résultat commune à une simulation et à une répartition enregistrée. */
export type ResultRow = {
  consumerId: string;
  name: string;
  kwh: number;
  ratio: number;
  provenance: Provenance;
  appliedMethod: AppliedMethod;
  electricityAmount: number;
  waterAmount: number;
  totalAmount: number;
  payableAmount: number;
};

export function rowsFromSimulation(consumers: ConsumerAllocationResult[]): ResultRow[] {
  return consumers.map((c) => ({
    consumerId: c.consumerId,
    name: c.name,
    kwh: c.kwh,
    ratio: c.ratio,
    provenance: c.provenance,
    appliedMethod: c.appliedMethod,
    electricityAmount: c.electricityAmount,
    waterAmount: c.waterAmount,
    totalAmount: c.totalAmount,
    payableAmount: c.payableAmount,
  }));
}

export function rowsFromItems(items: AllocationItemDto[]): ResultRow[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((i) => ({
      consumerId: i.consumerId,
      name: i.consumerName,
      kwh: i.kwh,
      ratio: i.ratio,
      provenance: i.provenance,
      appliedMethod: i.appliedMethod,
      electricityAmount: i.electricityAmount,
      waterAmount: i.waterAmount,
      totalAmount: i.totalAmount,
      payableAmount: i.payableAmount,
    }));
}

/** Sommes exactes : en centimes (montants) et en Wh (énergie), pour éviter le bruit des flottants. */
export function totalsOf(rows: ResultRow[]) {
  const cents = (key: 'electricityAmount' | 'waterAmount' | 'totalAmount') => rows.reduce((s, r) => s + Math.round(r[key] * 100), 0) / 100;
  return {
    kwh: rows.reduce((s, r) => s + Math.round(r.kwh * 1000), 0) / 1000,
    ratio: rows.reduce((s, r) => s + r.ratio, 0),
    electricityAmount: cents('electricityAmount'),
    waterAmount: cents('waterAmount'),
    totalAmount: cents('totalAmount'),
    payableAmount: rows.reduce((s, r) => s + r.payableAmount, 0),
  };
}

export function readingLabel(reading: ReadingDto): string {
  const raw = reading.value !== reading.normalizedValue ? ` (affiché ${formatIndex(reading.value)})` : '';
  return `${formatIndex(reading.normalizedValue)}${raw} — ${formatDateTimeFr(reading.readingDate, reading.readingTime)}`;
}

/** Comparaison au centime / au Wh, sans flottant. */
export const sameCents = (a: number, b: number, toleranceAr = 0) => Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= Math.round(toleranceAr * 100);
export const sameWh = (a: number, b: number) => Math.round(a * 1000) === Math.round(b * 1000);
