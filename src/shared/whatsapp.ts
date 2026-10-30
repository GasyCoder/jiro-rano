import { formatDateFr } from './billing/dates';
import { formatAriary, formatKwh, formatNumber } from './billing/format';
import type { Provenance } from './domain';

export type WhatsAppLanguage = 'mg' | 'fr';

export type WhatsAppMessageInput = {
  buildingName: string;
  periodStart: string;
  periodEnd: string;
  totalKwh: number;
  electricityAmount: number;
  waterAmount: number;
  totalAmount: number;
  effectivePricePerKwh: number;
  consumers: {
    name: string;
    kwh: number;
    provenance: Provenance;
    totalAmount: number;
    payableAmount: number;
  }[];
};

const PROVENANCE_SHORT: Record<WhatsAppLanguage, Record<Provenance, string>> = {
  fr: { MEASURED: 'mesuré', PRORATED: 'proratisé', ESTIMATED: 'estimé', MANUAL: 'corrigé', DIFFERENCE: 'par différence' },
  mg: { MEASURED: 'mesuré', PRORATED: 'proratisé', ESTIMATED: 'estimé', MANUAL: 'corrigé', DIFFERENCE: 'par différence' },
};

const TEXT: Record<WhatsAppLanguage, { greeting: string; intro: string; price: string; closing: string }> = {
  mg: {
    greeting: 'Salama daholo 🙏',
    intro: 'Ity ny fizarana ny faktiora JIRAMA',
    price: 'efa tafiditra ao daholo ny tranches, taxes, TVA',
    closing: 'Raha misy fanontaniana, afaka jerena miaraka ny antsipiriany sy ny sary compteur. Misaotra daholo 🙏',
  },
  fr: {
    greeting: 'Bonjour à tous 🙏',
    intro: 'Voici la répartition de la facture JIRAMA',
    price: 'tranches, taxes et TVA comprises',
    closing: 'Le détail des calculs et les photos des compteurs sont disponibles sur demande. Merci à tous 🙏',
  },
};

/** Message court, prêt à coller dans WhatsApp, généré uniquement à partir d'une répartition calculée. */
export function buildWhatsAppMessage(input: WhatsAppMessageInput, language: WhatsAppLanguage = 'mg'): string {
  const t = TEXT[language];
  const lines: string[] = [
    t.greeting,
    '',
    `${t.intro} — ${input.buildingName}`,
    `Période : ${formatDateFr(input.periodStart)} → ${formatDateFr(input.periodEnd)}`,
    '',
    `Consommation totale : ${formatKwh(input.totalKwh)} kWh`,
    `Électricité : ${formatAriary(input.electricityAmount)}`,
    `Eau : ${formatAriary(input.waterAmount)}`,
    `Prix moyen : ${formatNumber(input.effectivePricePerKwh, 2)} Ar/kWh (${t.price})`,
  ];
  for (const consumer of input.consumers) {
    lines.push(
      '',
      `*${consumer.name}*`,
      `${formatKwh(consumer.kwh)} kWh (${PROVENANCE_SHORT[language][consumer.provenance]})`,
      `Total : ${formatAriary(consumer.payableAmount, 0)}`,
    );
  }
  lines.push('', `Total facture : ${formatAriary(input.totalAmount)}`, '', t.closing);
  return lines.join('\n');
}
