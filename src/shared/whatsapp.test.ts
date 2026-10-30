import { describe, expect, it } from 'vitest';
import { buildWhatsAppMessage } from './whatsapp';

describe('buildWhatsAppMessage', () => {
  const input = {
    buildingName: 'Mangarivotra',
    periodStart: '2026-08-27',
    periodEnd: '2026-09-26',
    totalKwh: 443,
    electricityAmount: 328_798.76,
    waterAmount: 3_770,
    totalAmount: 332_568.76,
    effectivePricePerKwh: 742.2094,
    consumers: [
      { name: 'RDC', kwh: 168, provenance: 'ESTIMATED' as const, totalAmount: 125_947.85, payableAmount: 125_948 },
      { name: '1er étage', kwh: 111, provenance: 'DIFFERENCE' as const, totalAmount: 83_641.91, payableAmount: 83_642 },
    ],
  };

  it('génère un message malgache + français avec les montants essentiels', () => {
    const message = buildWhatsAppMessage(input, 'mg');
    expect(message).toContain('Salama daholo');
    expect(message).toContain('Période : 27/08/2026 → 26/09/2026');
    expect(message).toContain('Électricité : 328 798,76 Ar');
    expect(message).toContain('*1er étage*\n111 kWh (par différence)\nTotal : 83 642 Ar');
    expect(message).toContain('Total facture : 332 568,76 Ar');
  });

  it('génère une version française', () => {
    expect(buildWhatsAppMessage(input, 'fr')).toContain('Bonjour à tous');
  });
});
