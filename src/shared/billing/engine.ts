import type { AppliedMethod, Provenance } from '../domain';
import { daysBetween, formatDateFr, formatDateTimeFr, isValidDate, isValidTime, SECONDS_PER_DAY, toEpochSeconds } from './dates';
import { formatAriaryFromCentimes, formatIndex, formatKwhFromWh, formatNumber, formatPercent } from './format';
import type {
  AllocationFailure,
  AllocationInput,
  AllocationIssue,
  AllocationOutcome,
  AllocationResult,
  CalculationStep,
  ConsumerAllocationInput,
  ConsumerAllocationResult,
  IssueCode,
  MeasurementDetails,
  ReadingPoint,
  StepCode,
  WaterAllocationConfig,
} from './types';
import { apportion, mulDivRound, toCentimes, toWh, weightToInt } from './units';

/** Incrémenter à chaque changement de formule : la version est enregistrée avec chaque répartition. */
export const ENGINE_VERSION = '1.0.0';
export const DEFAULT_TOLERANCE_AR = 2;

/**
 * Moteur de répartition d'une facture JIRAMA entre consommateurs.
 * Pur et déterministe : aucune dépendance à la base, à l'interface ou à l'heure courante.
 */
export class BillingAllocationEngine {
  readonly version = ENGINE_VERSION;

  allocate(input: AllocationInput): AllocationOutcome {
    return allocateBill(input);
  }
}

type Slot = {
  consumer: ConsumerAllocationInput;
  /** Valeur déterminée indépendamment des autres (sous-compteur, estimation, correction). */
  fixed: boolean;
  wh: number | null;
  appliedMethod: AppliedMethod | null;
  provenance: Provenance | null;
  measurement?: MeasurementDetails;
};

type Period = {
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  billDays: number;
  billSeconds: number;
};

class Trace {
  readonly errors: AllocationIssue[] = [];
  readonly warnings: AllocationIssue[] = [];
  readonly steps: CalculationStep[] = [];

  error(code: IssueCode, message: string, extra: Pick<AllocationIssue, 'consumerId' | 'params'> = {}): void {
    this.errors.push({ code, message, ...extra });
  }

  warn(code: IssueCode, message: string, extra: Pick<AllocationIssue, 'consumerId' | 'params'> = {}): void {
    this.warnings.push({ code, message, ...extra });
  }

  step(code: StepCode, label: string, detail: Pick<CalculationStep, 'consumerId' | 'formula' | 'result'> = {}): void {
    this.steps.push({ order: this.steps.length + 1, code, label, ...detail });
  }
}

export function allocateBill(input: AllocationInput): AllocationOutcome {
  const trace = new Trace();
  const toleranceAr = input.toleranceAr ?? DEFAULT_TOLERANCE_AR;
  const water: WaterAllocationConfig = input.water ?? { mode: 'EQUAL' };
  const slots: Slot[] = input.consumers.map((consumer) => ({
    consumer,
    fixed: Boolean(consumer.override) || consumer.method === 'SUB_METER' || consumer.method === 'MANUAL_APPROXIMATION',
    wh: null,
    appliedMethod: null,
    provenance: null,
  }));
  const fail = (): AllocationFailure => ({
    ok: false,
    engineVersion: ENGINE_VERSION,
    errors: trace.errors,
    warnings: trace.warnings,
    calculationDetails: trace.steps,
    partial: slots.map((s) => ({
      consumerId: s.consumer.id,
      name: s.consumer.name,
      kwh: s.wh === null ? null : s.wh / 1000,
      provenance: s.provenance,
    })),
  });

  checkBillInput(input, toleranceAr, trace);
  checkConsumerList(input.consumers, trace);
  if (trace.errors.length > 0) return fail();

  const totalWh = toWh(input.totalKwh);
  const electricityC = toCentimes(input.electricityAmount);
  const waterC = toCentimes(input.waterAmount);
  const toleranceC = toCentimes(toleranceAr);
  const computedDays = daysBetween(input.periodStart, input.periodEnd);
  const billDays = input.billDays ?? computedDays;
  if (input.billDays != null && input.billDays !== computedDays) {
    trace.warn(
      'BILL_DAYS_MISMATCH',
      `La facture indique ${billDays} jours alors que les dates donnent ${computedDays} jours : le nombre de jours de la facture est utilisé.`,
      { params: { billDays, computedDays } },
    );
  }
  const period: Period = {
    start: input.periodStart,
    end: input.periodEnd,
    startSec: toEpochSeconds(input.periodStart),
    endSec: toEpochSeconds(input.periodEnd),
    billDays,
    billSeconds: billDays * SECONDS_PER_DAY,
  };

  trace.step('BILL_SUMMARY', 'Facture JIRAMA', {
    formula: `${formatDateFr(period.start)} → ${formatDateFr(period.end)} (${billDays} jours)`,
    result: `${formatKwhFromWh(totalWh)} kWh · électricité ${formatAriaryFromCentimes(electricityC)} · eau ${formatAriaryFromCentimes(waterC)}`,
  });
  checkMainMeter(input, totalWh, trace);

  // 1. Valeurs déterminées individuellement : sous-compteurs, estimations, corrections.
  for (const slot of slots) {
    if (slot.fixed) resolveFixed(slot, period, trace);
  }
  checkPoolComposition(slots, trace);
  if (trace.errors.length > 0) return fail();

  // 2. Le reste du compteur principal revient aux consommateurs sans valeur propre.
  const fixedSlots = slots.filter((s) => s.fixed);
  const pool = slots.filter((s) => !s.fixed);
  const fixedWh = sum(fixedSlots.map((s) => s.wh ?? 0));
  const remainderWh = totalWh - fixedWh;
  if (remainderWh < 0) {
    trace.error(
      'SUBMETERS_EXCEED_MAIN',
      `Les consommations attribuées (${formatKwhFromWh(fixedWh)} kWh) dépassent la consommation du compteur principal ` +
        `(${formatKwhFromWh(totalWh)} kWh) de ${formatKwhFromWh(-remainderWh)} kWh. Vérifiez les relevés des sous-compteurs.`,
      { params: { fixedKwh: fixedWh / 1000, totalKwh: totalWh / 1000 } },
    );
    return fail();
  }
  resolvePool(pool, fixedSlots, totalWh, remainderWh, trace);
  if (trace.errors.length > 0) return fail();

  const whs = slots.map((s) => s.wh ?? 0);
  const allocatedWh = sum(whs);
  if (allocatedWh !== totalWh) {
    trace.error('UNALLOCATED_KWH', `La somme attribuée (${formatKwhFromWh(allocatedWh)} kWh) diffère du total facturé (${formatKwhFromWh(totalWh)} kWh).`);
    return fail();
  }
  trace.step('KWH_CHECK', 'Contrôle des consommations', {
    formula: whs.map(formatKwhFromWh).join(' + '),
    result: `${formatKwhFromWh(allocatedWh)} kWh = ${formatKwhFromWh(totalWh)} kWh facturés ✓`,
  });

  const estimated = slots.filter((s) => s.provenance === 'ESTIMATED').map((s) => s.consumer.name);
  if (estimated.length > 0) {
    trace.warn('ESTIMATED_VALUES', `Valeurs estimées, non issues d'un relevé : ${estimated.join(', ')}.`);
  }

  // 3. Électricité : chaque consommateur paie le même prix moyen effectif.
  const electricity = apportion(electricityC, whs);
  const effectivePrice = electricityC / 100 / (totalWh / 1000);
  trace.step('EFFECTIVE_PRICE', 'Prix moyen effectif du kWh', {
    formula: `${formatAriaryFromCentimes(electricityC)} ÷ ${formatKwhFromWh(totalWh)} kWh`,
    result: `${formatNumber(effectivePrice, 2)} Ar/kWh (tranches, taxes, TVA, redevance et prime fixe inclus)`,
  });
  slots.forEach((slot, i) => {
    trace.step('ELECTRICITY_SHARE', `${slot.consumer.name} — électricité`, {
      consumerId: slot.consumer.id,
      formula: `${formatKwhFromWh(whs[i] ?? 0)} ÷ ${formatKwhFromWh(totalWh)} × ${formatAriaryFromCentimes(electricityC)}`,
      result: `${formatAriaryFromCentimes(electricity[i] ?? 0)} (${formatPercent((whs[i] ?? 0) / totalWh)})`,
    });
  });
  noteRounding('électricité', slots, electricity, whs.map((wh) => mulDivRound(electricityC, wh, totalWh)), trace);

  // 4. Eau.
  const waterShares = allocateWater(water, slots, whs, waterC, toleranceC, trace);
  if (!waterShares) return fail();

  // 5. Totaux et contrôles.
  const totals = slots.map((_, i) => (electricity[i] ?? 0) + (waterShares[i] ?? 0));
  const payables = roundToAriary(totals);
  slots.forEach((slot, i) => {
    trace.step('CONSUMER_TOTAL', `${slot.consumer.name} — total`, {
      consumerId: slot.consumer.id,
      formula: `${formatAriaryFromCentimes(electricity[i] ?? 0)} + ${formatAriaryFromCentimes(waterShares[i] ?? 0)}`,
      result: `${formatAriaryFromCentimes(totals[i] ?? 0)} → à payer ${formatNumber(payables[i] ?? 0, 0)} Ar`,
    });
  });

  const sumElectricity = sum(electricity);
  const sumWater = sum(waterShares);
  const sumTotal = sum(totals);
  if (Math.abs(sumElectricity - electricityC) > toleranceC) {
    trace.error('ELECTRICITY_MISMATCH', `La somme des parts d'électricité (${formatAriaryFromCentimes(sumElectricity)}) diffère de la facture (${formatAriaryFromCentimes(electricityC)}).`);
  }
  let totalCheck = `${formatAriaryFromCentimes(sumTotal)}`;
  if (input.billTotalAmount != null) {
    const billTotalC = toCentimes(input.billTotalAmount);
    const diff = sumTotal - billTotalC;
    if (Math.abs(diff) > toleranceC) {
      trace.error(
        'TOTAL_MISMATCH',
        `Le total réparti (${formatAriaryFromCentimes(sumTotal)}) ne correspond pas au total de la facture ` +
          `(${formatAriaryFromCentimes(billTotalC)}) : écart de ${formatAriaryFromCentimes(Math.abs(diff))}, ` +
          `au-delà de la tolérance de ${formatAriaryFromCentimes(toleranceC)}. Vérifiez que électricité + eau = total.`,
        { params: { diff: diff / 100 } },
      );
    } else if (diff !== 0) {
      trace.warn('TOTAL_ROUNDING', `Écart d'arrondi de ${formatAriaryFromCentimes(Math.abs(diff))} avec le total de la facture (tolérance ${formatAriaryFromCentimes(toleranceC)}).`);
    }
    totalCheck += diff === 0 ? ' = total facture ✓' : ` (facture : ${formatAriaryFromCentimes(billTotalC)})`;
  }
  trace.step('TOTAL_CHECK', 'Contrôle des montants', {
    formula: `Σ électricité ${formatAriaryFromCentimes(sumElectricity)} + Σ eau ${formatAriaryFromCentimes(sumWater)}`,
    result: `${totalCheck} · à payer arrondi : ${formatNumber(sum(payables), 0)} Ar`,
  });
  if (trace.errors.length > 0) return fail();

  const consumers: ConsumerAllocationResult[] = slots.map((slot, i) => {
    const wh = whs[i] ?? 0;
    const elec = electricity[i] ?? 0;
    const wat = waterShares[i] ?? 0;
    const total = totals[i] ?? 0;
    const result: ConsumerAllocationResult = {
      consumerId: slot.consumer.id,
      name: slot.consumer.name,
      method: slot.consumer.method,
      appliedMethod: slot.appliedMethod ?? 'DIFFERENCE',
      provenance: slot.provenance ?? 'DIFFERENCE',
      wh,
      kwh: wh / 1000,
      ratio: wh / totalWh,
      electricityAmount: elec / 100,
      waterAmount: wat / 100,
      totalAmount: total / 100,
      payableAmount: payables[i] ?? 0,
      centimes: { electricity: elec, water: wat, total },
    };
    if (slot.measurement) result.measurement = slot.measurement;
    if (slot.consumer.method === 'WEIGHTED_SHARE' && slot.consumer.weight != null) result.weight = slot.consumer.weight;
    if (slot.consumer.override) result.overrideReason = slot.consumer.override.reason.trim();
    return result;
  });

  const success: AllocationResult = {
    ok: true,
    engineVersion: ENGINE_VERSION,
    billDays,
    consumers,
    totalKwh: totalWh / 1000,
    totalElectricityAmount: sumElectricity / 100,
    totalWaterAmount: sumWater / 100,
    totalAmount: sumTotal / 100,
    totalPayable: sum(payables),
    effectivePricePerKwh: Math.round(effectivePrice * 10_000) / 10_000,
    waterMode: water.mode,
    toleranceAr,
    warnings: trace.warnings,
    errors: [],
    calculationDetails: trace.steps,
  };
  return success;
}

// ---------------------------------------------------------------------------
// Contrôles d'entrée

function checkBillInput(input: AllocationInput, toleranceAr: number, trace: Trace): void {
  if (!Number.isFinite(input.totalKwh) || input.totalKwh <= 0) {
    trace.error('INVALID_TOTAL_KWH', 'La consommation totale de la facture doit être strictement positive.');
  }
  const amounts: [string, number | null | undefined][] = [
    ['montant électricité', input.electricityAmount],
    ['montant eau', input.waterAmount],
    ['total facture', input.billTotalAmount],
  ];
  for (const [label, value] of amounts) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      trace.error('INVALID_AMOUNT', `Le ${label} doit être un nombre positif.`);
    }
  }
  if (!Number.isFinite(toleranceAr) || toleranceAr < 0) {
    trace.error('INVALID_TOLERANCE', "La tolérance d'arrondi doit être positive.");
  }
  if (!isValidDate(input.periodStart) || !isValidDate(input.periodEnd)) {
    trace.error('INVALID_PERIOD', 'Les dates de début et de fin de période doivent être des dates valides (AAAA-MM-JJ).');
  } else if (toEpochSeconds(input.periodEnd) <= toEpochSeconds(input.periodStart)) {
    trace.error('INVALID_PERIOD', 'La fin de période doit être postérieure au début.');
  }
  if (input.billDays != null && (!Number.isInteger(input.billDays) || input.billDays <= 0)) {
    trace.error('INVALID_PERIOD', 'Le nombre de jours de la facture doit être un entier positif.');
  }
}

function checkConsumerList(consumers: ConsumerAllocationInput[], trace: Trace): void {
  if (consumers.length === 0) {
    trace.error('NO_CONSUMERS', 'Aucun consommateur à qui répartir la facture.');
    return;
  }
  const seen = new Set<string>();
  for (const consumer of consumers) {
    if (seen.has(consumer.id)) {
      trace.error('DUPLICATE_CONSUMER', `${consumer.name} apparaît plusieurs fois dans la répartition.`, { consumerId: consumer.id });
    }
    seen.add(consumer.id);
  }
}

function checkMainMeter(input: AllocationInput, totalWh: number, trace: Trace): void {
  const previous = input.mainMeterPreviousIndex;
  const current = input.mainMeterCurrentIndex;
  if (previous == null || current == null || !Number.isFinite(previous) || !Number.isFinite(current)) return;
  const diffWh = toWh(current) - toWh(previous);
  trace.step('MAIN_METER', 'Compteur principal JIRAMA', {
    formula: `${formatIndex(current)} − ${formatIndex(previous)}`,
    result: `${formatKwhFromWh(diffWh)} kWh`,
  });
  if (diffWh !== totalWh) {
    trace.warn(
      'MAIN_METER_MISMATCH',
      `Les index du compteur principal donnent ${formatKwhFromWh(diffWh)} kWh mais la facture compte ${formatKwhFromWh(totalWh)} kWh ` +
        `(écart ${formatKwhFromWh(Math.abs(totalWh - diffWh))} kWh). Vérifiez la facture originale : la répartition utilise les kWh facturés.`,
      { params: { indexKwh: diffWh / 1000, billedKwh: totalWh / 1000 } },
    );
  }
}

// ---------------------------------------------------------------------------
// Consommateurs à valeur propre

function resolveFixed(slot: Slot, period: Period, trace: Trace): void {
  const { consumer } = slot;
  const consumerId = consumer.id;

  if (consumer.override) {
    const { kwh, reason } = consumer.override;
    if (!Number.isFinite(kwh) || kwh < 0 || !reason || reason.trim() === '') {
      trace.error('INVALID_OVERRIDE', `${consumer.name} : une correction manuelle exige une valeur positive et une justification.`, { consumerId });
      return;
    }
    const original = consumer.method === 'SUB_METER' ? measure(consumer, period) : null;
    const originalText = original && !('code' in original) ? ` · valeur issue des relevés : ${formatKwhFromWh(projectWh(original, period))} kWh` : '';
    slot.wh = toWh(kwh);
    slot.appliedMethod = 'MANUAL_OVERRIDE';
    slot.provenance = 'MANUAL';
    trace.step('MANUAL_OVERRIDE', `${consumer.name} — correction manuelle`, {
      consumerId,
      formula: `Justification : ${reason.trim()}${originalText}`,
      result: `${formatKwhFromWh(slot.wh)} kWh`,
    });
    trace.warn('MANUAL_OVERRIDE_USED', `${consumer.name} : valeur corrigée manuellement (${formatKwhFromWh(slot.wh)} kWh) — ${reason.trim()}`, { consumerId });
    return;
  }

  if (consumer.method === 'MANUAL_APPROXIMATION') {
    const kwh = consumer.manualKwh;
    if (kwh == null || !Number.isFinite(kwh) || kwh < 0) {
      trace.error('INVALID_MANUAL_KWH', `${consumer.name} : la valeur estimée doit être un nombre de kWh positif.`, { consumerId });
      return;
    }
    slot.wh = toWh(kwh);
    slot.appliedMethod = 'MANUAL_APPROXIMATION';
    slot.provenance = 'ESTIMATED';
    trace.step('MANUAL_APPROXIMATION', `${consumer.name} — valeur estimée`, {
      consumerId,
      formula: 'Estimation validée par le gestionnaire (non mesurée)',
      result: `${formatKwhFromWh(slot.wh)} kWh`,
    });
    return;
  }

  const m = measure(consumer, period);
  if ('code' in m) {
    trace.errors.push({ ...m, consumerId });
    return;
  }
  if (m.rollover) {
    trace.warn('METER_ROLLOVER', `${consumer.name} : le compteur est repassé par zéro après ${formatIndex(consumer.meterRolloverAt ?? 0)} ; la consommation en tient compte.`, { consumerId });
  }
  const measuredDays = m.seconds / SECONDS_PER_DAY;
  slot.measurement = {
    startValue: m.start.value,
    endValue: m.end.value,
    startDate: m.start.date,
    startTime: m.start.time || null,
    endDate: m.end.date,
    endTime: m.end.time || null,
    measuredKwh: m.measuredWh / 1000,
    measuredDays: Math.round(measuredDays * 10_000) / 10_000,
    dailyKwh: Math.round((m.measuredWh / 1000 / measuredDays) * 10_000) / 10_000,
    rollover: m.rollover,
    ...(m.start.id ? { startReadingId: m.start.id } : {}),
    ...(m.end.id ? { endReadingId: m.end.id } : {}),
  };
  const indexFormula = m.rollover
    ? `(${formatIndex(consumer.meterRolloverAt ?? 0)} + ${formatIndex(m.end.value)}) − ${formatIndex(m.start.value)}`
    : `${formatIndex(m.end.value)} − ${formatIndex(m.start.value)}`;

  if (m.exact) {
    slot.wh = m.measuredWh;
    slot.appliedMethod = 'SUB_METER_EXACT';
    slot.provenance = 'MEASURED';
    trace.step('SUB_METER_EXACT', `${consumer.name} — sous-compteur relevé aux dates de la facture`, {
      consumerId,
      formula: indexFormula,
      result: `${formatKwhFromWh(slot.wh)} kWh`,
    });
    return;
  }

  if (!m.hasTimes) {
    trace.warn('READING_TIME_MISSING', `${consumer.name} : heure de relevé inconnue, la durée mesurée est comptée en jours entiers.`, { consumerId });
  }
  const daysText = formatNumber(measuredDays, m.hasTimes ? 4 : 0);
  trace.step('SUB_METER_MEASURED', `${consumer.name} — consommation mesurée`, {
    consumerId,
    formula: `${indexFormula} (${formatDateTimeFr(m.start.date, m.hasTimes ? m.start.time : null)} → ${formatDateTimeFr(m.end.date, m.hasTimes ? m.end.time : null)}, ${daysText} j)`,
    result: `${formatKwhFromWh(m.measuredWh)} kWh`,
  });
  slot.wh = projectWh(m, period);
  slot.appliedMethod = 'SUB_METER_PRORATED';
  slot.provenance = 'PRORATED';
  trace.step('SUB_METER_PRORATED', `${consumer.name} — proratisation sur ${period.billDays} jours (moyenne ${formatNumber(m.measuredWh / 1000 / measuredDays, 3)} kWh/jour)`, {
    consumerId,
    formula: `${formatKwhFromWh(m.measuredWh)} kWh ÷ ${daysText} j × ${period.billDays} j`,
    result: `${formatKwhFromWh(slot.wh)} kWh`,
  });

  const overlap = Math.max(0, Math.min(m.endSec, period.endSec) - Math.max(m.startSec, period.startSec));
  if (m.seconds < period.billSeconds / 2) {
    trace.warn(
      'SHORT_MEASUREMENT',
      `${consumer.name} : mesure sur ${daysText} jours seulement (${formatPercent(m.seconds / period.billSeconds, 0)} de la période facturée). ` +
        `La moyenne journalière est extrapolée à ${period.billDays} jours : résultat moins fiable.`,
      { consumerId, params: { measuredDays: Math.round(measuredDays * 100) / 100 } },
    );
  }
  if (overlap < m.seconds / 2) {
    trace.warn(
      'MEASUREMENT_OUTSIDE_PERIOD',
      `${consumer.name} : ${formatPercent(1 - overlap / m.seconds, 0)} de la durée mesurée se situe hors de la période de la facture.`,
      { consumerId },
    );
  }
}

type Measure = {
  start: ReadingPoint;
  end: ReadingPoint;
  startSec: number;
  endSec: number;
  seconds: number;
  measuredWh: number;
  hasTimes: boolean;
  rollover: boolean;
  exact: boolean;
};

function measure(consumer: ConsumerAllocationInput, period: Period): Measure | AllocationIssue {
  const start = consumer.readingStart;
  const end = consumer.readingEnd;
  if (!start || !end) {
    return { code: 'MISSING_READINGS', message: `${consumer.name} : il faut un relevé de début et un relevé de fin du sous-compteur.` };
  }
  for (const reading of [start, end]) {
    const badTime = reading.time != null && reading.time !== '' && !isValidTime(reading.time);
    if (!Number.isFinite(reading.value) || reading.value < 0 || !isValidDate(reading.date) || badTime) {
      return { code: 'INVALID_READING', message: `${consumer.name} : relevé invalide (index ${reading.value}, date ${reading.date}).` };
    }
  }
  const hasTimes = Boolean(start.time && end.time);
  const startSec = toEpochSeconds(start.date, hasTimes ? start.time : null);
  const endSec = toEpochSeconds(end.date, hasTimes ? end.time : null);
  if (endSec <= startSec) {
    return {
      code: 'READINGS_ORDER',
      message: `${consumer.name} : le relevé de fin (${formatDateTimeFr(end.date, end.time)}) doit être postérieur au relevé de début (${formatDateTimeFr(start.date, start.time)}).`,
    };
  }
  let measuredWh = toWh(end.value) - toWh(start.value);
  let rollover = false;
  if (measuredWh < 0 && consumer.meterRolloverAt != null && consumer.meterRolloverAt > 0) {
    measuredWh += toWh(consumer.meterRolloverAt);
    rollover = true;
  }
  if (measuredWh < 0) {
    return {
      code: 'NEGATIVE_CONSUMPTION',
      message: `${consumer.name} : le nouvel index (${formatIndex(end.value)}) est inférieur à l'ancien (${formatIndex(start.value)}). Vérifiez les relevés.`,
    };
  }
  return {
    start,
    end,
    startSec,
    endSec,
    seconds: endSec - startSec,
    measuredWh,
    hasTimes,
    rollover,
    exact: start.date === period.start && end.date === period.end,
  };
}

function projectWh(m: Measure, period: Period): number {
  return m.exact ? m.measuredWh : mulDivRound(m.measuredWh, period.billSeconds, m.seconds);
}

// ---------------------------------------------------------------------------
// Consommateurs sans valeur propre : différence, part égale, part pondérée

function checkPoolComposition(slots: Slot[], trace: Trace): void {
  const pool = slots.filter((s) => !s.fixed);
  const differences = pool.filter((s) => s.consumer.method === 'DIFFERENCE');
  if (differences.length > 1) {
    trace.error('MULTIPLE_DIFFERENCE', `Un seul consommateur peut être calculé par différence (actuellement : ${differences.map((s) => s.consumer.name).join(', ')}).`);
  } else if (differences.length === 1 && pool.length > 1) {
    const others = pool.filter((s) => s.consumer.method !== 'DIFFERENCE').map((s) => s.consumer.name);
    trace.error(
      'DIFFERENCE_WITH_SHARES',
      `${differences[0]?.consumer.name} prend tout le reste par différence : il ne peut pas être combiné avec une part égale ou pondérée (${others.join(', ')}).`,
    );
  }
  for (const slot of pool) {
    const weight = slot.consumer.weight;
    if (slot.consumer.method === 'WEIGHTED_SHARE' && (weight == null || !Number.isFinite(weight) || weight <= 0)) {
      trace.error('INVALID_WEIGHT', `${slot.consumer.name} : le coefficient de pondération doit être strictement positif.`, { consumerId: slot.consumer.id });
    }
  }
}

function resolvePool(pool: Slot[], fixedSlots: Slot[], totalWh: number, remainderWh: number, trace: Trace): void {
  const subtraction = [formatKwhFromWh(totalWh), ...fixedSlots.map((s) => formatKwhFromWh(s.wh ?? 0))].join(' − ');
  if (pool.length === 0) {
    if (remainderWh !== 0) {
      trace.error(
        'UNALLOCATED_KWH',
        `${formatKwhFromWh(remainderWh)} kWh du compteur principal ne sont attribués à personne. ` +
          'Ajoutez un consommateur calculé par différence (par exemple « Parties communes ») ou corrigez les relevés.',
        { params: { unallocatedKwh: remainderWh / 1000 } },
      );
    }
    return;
  }

  const first = pool[0];
  if (pool.length === 1 && first && first.consumer.method === 'DIFFERENCE') {
    first.wh = remainderWh;
    first.appliedMethod = 'DIFFERENCE';
    first.provenance = 'DIFFERENCE';
    trace.step('DIFFERENCE', `${first.consumer.name} — par différence avec le compteur principal`, {
      consumerId: first.consumer.id,
      formula: subtraction,
      result: `${formatKwhFromWh(remainderWh)} kWh`,
    });
    if (remainderWh === 0) {
      trace.warn('DIFFERENCE_ZERO', `${first.consumer.name} : la différence est nulle, aucune consommation ne lui est attribuée.`, { consumerId: first.consumer.id });
    }
    return;
  }

  if (fixedSlots.length > 0) {
    trace.step('REMAINDER', 'Reste à répartir', { formula: subtraction, result: `${formatKwhFromWh(remainderWh)} kWh` });
  }
  const weights = pool.map((s) => (s.consumer.method === 'WEIGHTED_SHARE' ? (s.consumer.weight ?? 0) : 1));
  const shares = apportion(remainderWh, weights.map(weightToInt));
  const allEqual = pool.every((s) => s.consumer.method === 'EQUAL_SHARE');
  const weightTotal = sum(weights.map(weightToInt)) / 1_000_000;
  pool.forEach((slot, i) => {
    const weighted = slot.consumer.method === 'WEIGHTED_SHARE';
    slot.wh = shares[i] ?? 0;
    slot.appliedMethod = weighted ? 'WEIGHTED_SHARE' : 'EQUAL_SHARE';
    slot.provenance = 'ESTIMATED';
    trace.step(weighted ? 'WEIGHTED_SHARE' : 'EQUAL_SHARE', `${slot.consumer.name} — ${weighted ? 'part pondérée' : 'part égale'}`, {
      consumerId: slot.consumer.id,
      formula: allEqual
        ? `${formatKwhFromWh(remainderWh)} kWh ÷ ${pool.length}`
        : `${formatKwhFromWh(remainderWh)} kWh × ${formatCoefficient(weights[i] ?? 0)} ÷ ${formatCoefficient(weightTotal)}`,
      result: `${formatKwhFromWh(slot.wh)} kWh`,
    });
  });
}

// ---------------------------------------------------------------------------
// Eau

function allocateWater(
  config: WaterAllocationConfig,
  slots: Slot[],
  whs: number[],
  waterC: number,
  toleranceC: number,
  trace: Trace,
): number[] | null {
  const totalWh = sum(whs);

  if (config.mode === 'MANUAL') {
    const amounts: number[] = [];
    for (const slot of slots) {
      const value = slot.consumer.manualWaterAmount;
      if (value == null || !Number.isFinite(value) || value < 0) {
        trace.error('INVALID_WATER_AMOUNT', `${slot.consumer.name} : montant d'eau manquant ou invalide.`, { consumerId: slot.consumer.id });
        continue;
      }
      amounts.push(toCentimes(value));
    }
    if (trace.errors.length > 0) return null;
    const diff = sum(amounts) - waterC;
    if (Math.abs(diff) > toleranceC) {
      trace.error(
        'WATER_MANUAL_MISMATCH',
        `Les montants d'eau saisis totalisent ${formatAriaryFromCentimes(sum(amounts))} au lieu de ${formatAriaryFromCentimes(waterC)}.`,
      );
      return null;
    }
    if (diff !== 0) {
      trace.warn('WATER_MANUAL_ROUNDING', `Écart d'arrondi de ${formatAriaryFromCentimes(Math.abs(diff))} sur l'eau (montants saisis manuellement).`);
    }
    slots.forEach((slot, i) => {
      trace.step('WATER_SHARE', `${slot.consumer.name} — eau`, {
        consumerId: slot.consumer.id,
        formula: 'Montant saisi manuellement',
        result: formatAriaryFromCentimes(amounts[i] ?? 0),
      });
    });
    return amounts;
  }

  let weights: number[];
  let describe: (i: number) => string;
  if (config.mode === 'EQUAL') {
    weights = slots.map(() => 1);
    describe = () => `${formatAriaryFromCentimes(waterC)} ÷ ${slots.length}`;
  } else if (config.key === 'KWH') {
    weights = whs;
    describe = (i) => `${formatKwhFromWh(whs[i] ?? 0)} ÷ ${formatKwhFromWh(totalWh)} × ${formatAriaryFromCentimes(waterC)}`;
  } else {
    const raw = slots.map((s) => s.consumer.waterWeight ?? 1);
    const invalid = slots.filter((_, i) => !Number.isFinite(raw[i]) || (raw[i] ?? 0) < 0);
    for (const slot of invalid) {
      trace.error('INVALID_WEIGHT', `${slot.consumer.name} : coefficient d'eau invalide.`, { consumerId: slot.consumer.id });
    }
    if (invalid.length > 0) return null;
    weights = raw.map(weightToInt);
    const weightTotal = sum(raw);
    describe = (i) => `${formatCoefficient(raw[i] ?? 0)} ÷ ${formatCoefficient(weightTotal)} × ${formatAriaryFromCentimes(waterC)}`;
  }
  if (waterC > 0 && sum(weights) === 0) {
    trace.error('WATER_WEIGHTS_ZERO', "Aucun consommateur n'a de part d'eau : impossible de répartir le montant de l'eau.");
    return null;
  }
  const shares = waterC === 0 ? slots.map(() => 0) : apportion(waterC, weights);
  const weightSum = sum(weights);
  slots.forEach((slot, i) => {
    const naive = weightSum === 0 ? 0 : mulDivRound(waterC, weights[i] ?? 0, weightSum);
    const adjusted = (shares[i] ?? 0) !== naive ? ' (ajusté au centime pour que la somme soit exacte)' : '';
    trace.step('WATER_SHARE', `${slot.consumer.name} — eau`, {
      consumerId: slot.consumer.id,
      formula: describe(i),
      result: `${formatAriaryFromCentimes(shares[i] ?? 0)}${adjusted}`,
    });
  });
  return shares;
}

// ---------------------------------------------------------------------------
// Arrondis

function noteRounding(label: string, slots: Slot[], actual: number[], naive: number[], trace: Trace): void {
  const adjustments = slots
    .map((slot, i) => ({ name: slot.consumer.name, delta: (actual[i] ?? 0) - (naive[i] ?? 0) }))
    .filter((a) => a.delta !== 0);
  if (adjustments.length === 0) return;
  trace.step('ROUNDING', `Ajustement d'arrondi (${label})`, {
    formula: 'Méthode du plus fort reste : la somme des parts est exactement égale au montant facturé',
    result: adjustments.map((a) => `${a.name} ${a.delta > 0 ? '+' : '−'}${formatAriaryFromCentimes(Math.abs(a.delta))}`).join(' · '),
  });
}

/**
 * Montants à payer en Ariary entiers : arrondi du total au plus proche, puis répartition
 * des Ariary restants aux plus forts restes. La somme est égale au total facture arrondi.
 */
export function roundToAriary(centimes: number[]): number[] {
  const target = Math.floor((sum(centimes) + 50) / 100);
  const result = centimes.map((c) => Math.floor(c / 100));
  let left = target - sum(result);
  const order = centimes.map((c, index) => ({ index, rest: c % 100 })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    left -= 1;
  }
  return result;
}

/** Coefficient sans zéros inutiles : 0,8 ; 1 ; 1,25. */
function formatCoefficient(value: number): string {
  return formatNumber(value, 3).replace(/,(\d*?)0+$/, (_match, digits: string) => (digits ? `,${digits}` : ''));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
