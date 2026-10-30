import { describe, expect, it } from 'vitest';
import { allocateBill, BillingAllocationEngine, roundToAriary } from './engine';
import type { AllocationFailure, AllocationInput, AllocationOutcome, AllocationResult, ConsumerAllocationInput } from './types';
import { apportion, decimalStringToMinorUnits, mulDivRound, toCentimes } from './units';

// Valeurs attendues calculées indépendamment (fractions exactes en Python) — voir docs/BILLING_ENGINE.md.

const OCTOBER_2026 = {
  totalKwh: 443,
  electricityAmount: 328_798.76,
  waterAmount: 3_770,
  billTotalAmount: 332_568.76,
  periodStart: '2026-08-27',
  periodEnd: '2026-09-26',
  billDays: 30,
} satisfies Omit<AllocationInput, 'consumers'>;

function bill(consumers: ConsumerAllocationInput[], overrides: Partial<AllocationInput> = {}): AllocationInput {
  return { ...OCTOBER_2026, consumers, ...overrides };
}

function expectOk(outcome: AllocationOutcome): AllocationResult {
  if (!outcome.ok) throw new Error(`Répartition en échec : ${outcome.errors.map((e) => e.message).join(' | ')}`);
  return outcome;
}

function expectFailure(outcome: AllocationOutcome): AllocationFailure {
  if (outcome.ok) throw new Error('La répartition aurait dû échouer');
  return outcome;
}

const byName = (result: AllocationResult, name: string) => {
  const consumer = result.consumers.find((c) => c.name === name);
  if (!consumer) throw new Error(`Consommateur introuvable : ${name}`);
  return consumer;
};

const sumCentimes = (result: AllocationResult, key: 'electricity' | 'water' | 'total') =>
  result.consumers.reduce((s, c) => s + c.centimes[key], 0);

describe('BillingAllocationEngine', () => {
  it('cas 1 — sous-compteurs relevés aux dates de la facture, 1er étage par différence : 443 − 168 − 164 = 111', () => {
    const result = expectOk(
      allocateBill(
        bill([
          { id: 'rdc', name: 'RDC', method: 'SUB_METER', readingStart: { value: 4589, date: '2026-08-27' }, readingEnd: { value: 4757, date: '2026-09-26' } },
          { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
          { id: '2e', name: '2e étage', method: 'SUB_METER', readingStart: { value: 7909, date: '2026-08-27' }, readingEnd: { value: 8073, date: '2026-09-26' } },
        ]),
      ),
    );
    expect(result.consumers.map((c) => c.kwh)).toEqual([168, 111, 164]);
    expect(result.consumers.map((c) => c.provenance)).toEqual(['MEASURED', 'DIFFERENCE', 'MEASURED']);
    expect(result.consumers.map((c) => c.appliedMethod)).toEqual(['SUB_METER_EXACT', 'DIFFERENCE', 'SUB_METER_EXACT']);
    expect(result.consumers.map((c) => c.centimes.electricity)).toEqual([12_469_118, 8_238_524, 12_172_234]);
    expect(result.consumers.map((c) => c.centimes.total)).toEqual([12_594_785, 8_364_191, 12_297_900]);
    expect(result.consumers.map((c) => c.payableAmount)).toEqual([125_948, 83_642, 122_979]);
    expect(result.totalElectricityAmount).toBe(328_798.76);
    expect(result.totalAmount).toBe(332_568.76);
    expect(result.effectivePricePerKwh).toBeCloseTo(742.2094, 4);
    expect(result.warnings).toEqual([]);
    const difference = result.calculationDetails.find((s) => s.code === 'DIFFERENCE');
    expect(difference?.formula).toBe('443 − 168 − 164');
    expect(difference?.result).toBe('111 kWh');
  });

  it('cas 1 bis — mêmes valeurs saisies comme estimations : enregistrées ESTIMATED, jamais MEASURED', () => {
    const result = expectOk(
      allocateBill(
        bill([
          { id: 'rdc', name: 'RDC', method: 'MANUAL_APPROXIMATION', manualKwh: 168 },
          { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
          { id: '2e', name: '2e étage', method: 'MANUAL_APPROXIMATION', manualKwh: 164 },
        ]),
      ),
    );
    expect(result.consumers.map((c) => [c.kwh, c.provenance])).toEqual([
      [168, 'ESTIMATED'],
      [111, 'DIFFERENCE'],
      [164, 'ESTIMATED'],
    ]);
    expect(result.warnings.map((w) => w.code)).toContain('ESTIMATED_VALUES');
  });

  it('cas 2 — proratisation (relevés réels d’octobre 2026, durées exactes à la seconde)', () => {
    const result = expectOk(
      allocateBill(
        bill(
          [
            {
              id: 'rdc',
              name: 'RDC',
              method: 'SUB_METER',
              readingStart: { value: 4757, date: '2026-09-24', time: '21:05:57' },
              readingEnd: { value: 4801, date: '2026-09-29', time: '09:07:20' },
            },
            { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
            {
              id: '2e',
              name: '2e étage',
              method: 'SUB_METER',
              readingStart: { value: 8073, date: '2026-08-27', time: '16:18' },
              readingEnd: { value: 8092, date: '2026-09-27', time: '14:25' },
            },
          ],
          { mainMeterPreviousIndex: 50_898, mainMeterCurrentIndex: 51_311 },
        ),
      ),
    );
    expect(result.consumers.map((c) => c.wh)).toEqual([293_271, 131_295, 18_434]);
    expect(result.consumers.map((c) => c.provenance)).toEqual(['PRORATED', 'DIFFERENCE', 'PRORATED']);
    expect(result.consumers.map((c) => c.centimes.electricity)).toEqual([21_766_849, 9_744_838, 1_368_189]);
    expect(result.consumers.map((c) => c.payableAmount)).toEqual([218_925, 98_705, 14_939]);
    expect(sumCentimes(result, 'total')).toBe(33_256_876);

    const rdc = byName(result, 'RDC');
    expect(rdc.measurement?.measuredKwh).toBe(44);
    expect(rdc.measurement?.measuredDays).toBeCloseTo(4.501, 3);

    const warningCodes = result.warnings.map((w) => [w.code, w.consumerId]);
    expect(warningCodes).toContainEqual(['MAIN_METER_MISMATCH', undefined]);
    expect(warningCodes).toContainEqual(['SHORT_MEASUREMENT', 'rdc']);
    expect(warningCodes).toContainEqual(['MEASUREMENT_OUTSIDE_PERIOD', 'rdc']);
    expect(warningCodes).not.toContainEqual(['SHORT_MEASUREMENT', '2e']);

    const prorated = result.calculationDetails.find((s) => s.code === 'SUB_METER_PRORATED' && s.consumerId === 'rdc');
    expect(prorated?.formula).toBe('44 kWh ÷ 4,5010 j × 30 j');
    expect(prorated?.result).toBe('293,27 kWh');
    // 131 295 Wh s'affiche 131,30 (arrondi décimal exact) : la soustraction affichée reste juste.
    const difference = result.calculationDetails.find((s) => s.code === 'DIFFERENCE');
    expect(`${difference?.formula} = ${difference?.result}`).toBe('443 − 293,27 − 18,43 = 131,30 kWh');
  });

  it('cas 2 bis — sans heure de relevé, la durée est comptée en jours entiers et un avertissement est émis', () => {
    const result = expectOk(
      allocateBill(
        bill([
          { id: '2e', name: '2e étage', method: 'SUB_METER', readingStart: { value: 8073, date: '2026-08-27' }, readingEnd: { value: 8092, date: '2026-09-27' } },
          { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
        ]),
      ),
    );
    // 19 kWh × 30 / 31 = 18,387 kWh
    expect(byName(result, '2e étage').wh).toBe(18_387);
    expect(result.warnings.map((w) => w.code)).toContain('READING_TIME_MISSING');
  });

  it('cas 3 — répartition égale : 443 / 3 sans perte de Wh', () => {
    const result = expectOk(
      allocateBill(
        bill([
          { id: 'a', name: 'RDC', method: 'EQUAL_SHARE' },
          { id: 'b', name: '1er étage', method: 'EQUAL_SHARE' },
          { id: 'c', name: '2e étage', method: 'EQUAL_SHARE' },
        ]),
      ),
    );
    expect(result.consumers.map((c) => c.wh)).toEqual([147_667, 147_667, 147_666]);
    expect(result.consumers.every((c) => c.provenance === 'ESTIMATED')).toBe(true);
    expect(result.consumers.map((c) => c.centimes.electricity)).toEqual([10_959_984, 10_959_983, 10_959_909]);
    expect(result.consumers.map((c) => c.payableAmount)).toEqual([110_857, 110_856, 110_856]);
  });

  it('répartition pondérée : coefficients 1 / 0,8 / 1,2', () => {
    const result = expectOk(
      allocateBill(
        bill([
          { id: 'a', name: 'RDC', method: 'WEIGHTED_SHARE', weight: 1 },
          { id: 'b', name: '1er étage', method: 'WEIGHTED_SHARE', weight: 0.8 },
          { id: 'c', name: '2e étage', method: 'WEIGHTED_SHARE', weight: 1.2 },
        ]),
      ),
    );
    expect(result.consumers.map((c) => c.wh)).toEqual([147_667, 118_133, 177_200]);
    const step = result.calculationDetails.find((s) => s.code === 'WEIGHTED_SHARE' && s.consumerId === 'b');
    expect(step?.formula).toBe('443 kWh × 0,8 ÷ 3');
  });

  it('cas 4 — arrondis : les sommes sont exactes au centime et les montants à payer totalisent le total arrondi', () => {
    const result = expectOk(
      allocateBill(
        bill(
          [
            { id: 'a', name: 'A', method: 'MANUAL_APPROXIMATION', manualKwh: 100.333 },
            { id: 'b', name: 'B', method: 'MANUAL_APPROXIMATION', manualKwh: 200.333 },
            { id: 'c', name: 'C', method: 'DIFFERENCE' },
          ],
          { totalKwh: 443, electricityAmount: 100_000.01, waterAmount: 1_000.01, billTotalAmount: 101_000.02 },
        ),
      ),
    );
    expect(sumCentimes(result, 'electricity')).toBe(10_000_001);
    expect(sumCentimes(result, 'water')).toBe(100_001);
    expect(sumCentimes(result, 'total')).toBe(10_100_002);
    expect(result.totalPayable).toBe(101_000);
    expect(result.consumers.reduce((s, c) => s + c.payableAmount, 0)).toBe(101_000);
  });

  it('cas 5 — somme incorrecte : kWh non attribués quand personne ne prend le reste', () => {
    const failure = expectFailure(
      allocateBill(
        bill([
          { id: 'a', name: 'RDC', method: 'MANUAL_APPROXIMATION', manualKwh: 200 },
          { id: 'b', name: '2e étage', method: 'MANUAL_APPROXIMATION', manualKwh: 200 },
        ]),
      ),
    );
    expect(failure.errors.map((e) => e.code)).toEqual(['UNALLOCATED_KWH']);
    expect(failure.partial.map((p) => p.kwh)).toEqual([200, 200]);
  });

  it('cas 5 bis — total facture incohérent avec électricité + eau : validation bloquée', () => {
    const failure = expectFailure(
      allocateBill(bill([{ id: 'a', name: 'RDC', method: 'DIFFERENCE' }], { billTotalAmount: 332_600 })),
    );
    expect(failure.errors.map((e) => e.code)).toEqual(['TOTAL_MISMATCH']);
  });

  it('cas 5 ter — écart de total dans la tolérance : simple avertissement', () => {
    const result = expectOk(allocateBill(bill([{ id: 'a', name: 'RDC', method: 'DIFFERENCE' }], { billTotalAmount: 332_570 })));
    expect(result.warnings.map((w) => w.code)).toContain('TOTAL_ROUNDING');
  });

  it('cas 6 — valeurs négatives refusées', () => {
    const negativeReading = expectFailure(
      allocateBill(
        bill([
          { id: 'rdc', name: 'RDC', method: 'SUB_METER', readingStart: { value: 4801, date: '2026-08-27' }, readingEnd: { value: 4757, date: '2026-09-26' } },
          { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
        ]),
      ),
    );
    expect(negativeReading.errors.map((e) => [e.code, e.consumerId])).toEqual([['NEGATIVE_CONSUMPTION', 'rdc']]);

    const negativeEstimate = expectFailure(
      allocateBill(bill([{ id: 'a', name: 'RDC', method: 'MANUAL_APPROXIMATION', manualKwh: -5 }, { id: 'b', name: '1er', method: 'DIFFERENCE' }])),
    );
    expect(negativeEstimate.errors.map((e) => e.code)).toEqual(['INVALID_MANUAL_KWH']);

    const negativeAmount = expectFailure(allocateBill(bill([{ id: 'a', name: 'RDC', method: 'DIFFERENCE' }], { electricityAmount: -1 })));
    expect(negativeAmount.errors.map((e) => e.code)).toEqual(['INVALID_AMOUNT']);
  });

  it('cas 6 bis — passage du compteur par zéro géré seulement si la capacité du compteur est connue', () => {
    const result = expectOk(
      allocateBill(
        bill([
          {
            id: 'rdc',
            name: 'RDC',
            method: 'SUB_METER',
            meterRolloverAt: 10_000,
            readingStart: { value: 9_990, date: '2026-08-27' },
            readingEnd: { value: 40, date: '2026-09-26' },
          },
          { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
        ]),
      ),
    );
    expect(byName(result, 'RDC').kwh).toBe(50);
    expect(result.warnings.map((w) => w.code)).toContain('METER_ROLLOVER');
  });

  it('cas 7 — sous-compteurs supérieurs au compteur principal : validation bloquée', () => {
    const failure = expectFailure(
      allocateBill(
        bill([
          { id: 'rdc', name: 'RDC', method: 'SUB_METER', readingStart: { value: 4000, date: '2026-08-27' }, readingEnd: { value: 4300, date: '2026-09-26' } },
          { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
          { id: '2e', name: '2e étage', method: 'SUB_METER', readingStart: { value: 8000, date: '2026-08-27' }, readingEnd: { value: 8200, date: '2026-09-26' } },
        ]),
      ),
    );
    expect(failure.errors.map((e) => e.code)).toEqual(['SUBMETERS_EXCEED_MAIN']);
    expect(failure.errors[0]?.message).toContain('500 kWh');
    expect(failure.errors[0]?.message).toContain('57 kWh');
  });

  it('cas 8 — eau partagée en trois : 3 770 / 3 au centime près, somme exacte', () => {
    const result = expectOk(
      allocateBill(
        bill([
          { id: 'a', name: 'RDC', method: 'EQUAL_SHARE' },
          { id: 'b', name: '1er étage', method: 'EQUAL_SHARE' },
          { id: 'c', name: '2e étage', method: 'EQUAL_SHARE' },
        ]),
      ),
    );
    expect(result.consumers.map((c) => c.waterAmount)).toEqual([1_256.67, 1_256.67, 1_256.66]);
    expect(result.totalWaterAmount).toBe(3_770);
  });

  it('eau proportionnelle aux kWh, et eau saisie manuellement contrôlée', () => {
    const consumers: ConsumerAllocationInput[] = [
      { id: 'a', name: 'RDC', method: 'MANUAL_APPROXIMATION', manualKwh: 168, manualWaterAmount: 2_000 },
      { id: 'b', name: '1er étage', method: 'DIFFERENCE', manualWaterAmount: 1_000 },
      { id: 'c', name: '2e étage', method: 'MANUAL_APPROXIMATION', manualKwh: 164, manualWaterAmount: 770 },
    ];
    const proportional = expectOk(allocateBill(bill(consumers, { water: { mode: 'PROPORTIONAL', key: 'KWH' } })));
    expect(proportional.consumers.map((c) => c.centimes.water)).toEqual(apportion(377_000, [168_000, 111_000, 164_000]));

    const manual = expectOk(allocateBill(bill(consumers, { water: { mode: 'MANUAL' } })));
    expect(manual.consumers.map((c) => c.waterAmount)).toEqual([2_000, 1_000, 770]);

    const wrong = expectFailure(
      allocateBill(bill(consumers.map((c) => ({ ...c, manualWaterAmount: 1_000 })), { water: { mode: 'MANUAL' } })),
    );
    expect(wrong.errors.map((e) => e.code)).toEqual(['WATER_MANUAL_MISMATCH']);
  });

  it('refuse plusieurs consommateurs par différence, ou une différence mêlée à des parts égales', () => {
    const two = expectFailure(allocateBill(bill([{ id: 'a', name: 'A', method: 'DIFFERENCE' }, { id: 'b', name: 'B', method: 'DIFFERENCE' }])));
    expect(two.errors.map((e) => e.code)).toEqual(['MULTIPLE_DIFFERENCE']);
    const mixed = expectFailure(allocateBill(bill([{ id: 'a', name: 'A', method: 'DIFFERENCE' }, { id: 'b', name: 'B', method: 'EQUAL_SHARE' }])));
    expect(mixed.errors.map((e) => e.code)).toEqual(['DIFFERENCE_WITH_SHARES']);
  });

  it('correction manuelle : provenance MANUAL, justification obligatoire et valeur d’origine tracée', () => {
    const consumers: ConsumerAllocationInput[] = [
      {
        id: 'rdc',
        name: 'RDC',
        method: 'SUB_METER',
        readingStart: { value: 4757, date: '2026-08-27' },
        readingEnd: { value: 4925, date: '2026-09-26' },
        override: { kwh: 160, reason: 'Compteur bloqué 3 jours, constaté sur place' },
      },
      { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
    ];
    const result = expectOk(allocateBill(bill(consumers)));
    const rdc = byName(result, 'RDC');
    expect([rdc.kwh, rdc.provenance, rdc.appliedMethod]).toEqual([160, 'MANUAL', 'MANUAL_OVERRIDE']);
    const step = result.calculationDetails.find((s) => s.code === 'MANUAL_OVERRIDE');
    expect(step?.formula).toContain('valeur issue des relevés : 168 kWh');

    const noReason = expectFailure(allocateBill(bill([{ ...consumers[0]!, override: { kwh: 160, reason: ' ' } }, consumers[1]!])));
    expect(noReason.errors.map((e) => e.code)).toEqual(['INVALID_OVERRIDE']);
  });

  it('est déterministe : même entrée JSON, même résultat', () => {
    const input = bill([
      { id: 'rdc', name: 'RDC', method: 'SUB_METER', readingStart: { value: 4757, date: '2026-09-24', time: '21:05' }, readingEnd: { value: 4801, date: '2026-09-29', time: '09:07' } },
      { id: '1er', name: '1er étage', method: 'DIFFERENCE' },
    ]);
    const engine = new BillingAllocationEngine();
    const first = engine.allocate(input);
    const second = engine.allocate(JSON.parse(JSON.stringify(input)) as AllocationInput);
    expect(second).toEqual(first);
  });
});

describe('arithmétique entière', () => {
  it('apportion conserve le total et départage par ordre d’entrée', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(0, [0, 0])).toEqual([0, 0]);
    expect(() => apportion(5, [0, 0])).toThrow();
  });

  it('mulDivRound arrondit au plus proche sans flottant', () => {
    expect(mulDivRound(44_000, 2_592_000, 388_883)).toBe(293_271);
    expect(mulDivRound(1, 1, 2)).toBe(1);
  });

  it('conversions monétaires exactes', () => {
    expect(toCentimes(328_798.76)).toBe(32_879_876);
    expect(decimalStringToMinorUnits('328798.76', 2)).toBe(32_879_876);
    expect(decimalStringToMinorUnits('443.000', 3)).toBe(443_000);
    expect(decimalStringToMinorUnits('12.3456', 2)).toBe(1_235);
  });

  it('roundToAriary : somme = total arrondi', () => {
    expect(roundToAriary([21_892_516, 9_870_505, 1_493_855])).toEqual([218_925, 98_705, 14_939]);
  });
});

describe('formatage français', () => {
  it('arrondit sans erreur binaire', async () => {
    const { formatNumber, formatKwhFromWh } = await import('./format');
    expect(formatNumber(131.295, 2)).toBe('131,30');
    expect(formatNumber(1.005, 2)).toBe('1,01');
    expect(formatNumber(328_798.76, 2)).toBe('328 798,76');
    expect(formatKwhFromWh(131_295)).toBe('131,30');
    expect(formatKwhFromWh(443_000)).toBe('443');
  });
});
