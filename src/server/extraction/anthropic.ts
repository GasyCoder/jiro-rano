import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { isValidDate, isValidTime } from '@shared/billing/dates';
import { billConsistencyWarnings } from './composite';
import {
  type BillExtractor,
  type ExtractedBill,
  type ExtractedMeterReading,
  ExtractionError,
  type MeterReadingExtractor,
} from './types';

/**
 * Lecture par vision IA (Claude). Branché uniquement si EXTRACTOR_PROVIDER=anthropic.
 * Le résultat n'est qu'une proposition : l'utilisateur confirme ou corrige toujours la valeur.
 */

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MeterOutput = z.object({
  integerDigits: z.string().describe('Chiffres de la partie entière (tambours noirs), de gauche à droite, exactement comme affichés, ex. "4801". Vide si illisible.'),
  tenthsDigit: z.string().describe('Chiffre du tambour des dixièmes (souvent rouge ou encadré). Vide si absent ou illisible.'),
  drumInTransition: z.boolean().describe('Vrai si un tambour de la partie entière est visiblement entre deux chiffres.'),
  transitionDetail: z.string().describe('Si un tambour est entre deux chiffres : lequel et entre quels chiffres. Sinon vide.'),
  dateDay: z.number().nullable().describe('Jour visible dans l’image (texte ajouté, en-tête de capture, fiche de la galerie), sinon null.'),
  dateMonth: z.number().nullable().describe('Mois visible (1-12), sinon null.'),
  dateYear: z.number().nullable().describe('Année visible, sinon null. Ne pas deviner.'),
  time: z.string().describe('Heure visible au format HH:mm, sinon vide.'),
  confidence: z.number().describe('Confiance de 0 à 1 dans la lecture des chiffres.'),
  observations: z.string().describe('Remarques utiles en français : reflets, flou, chiffre douteux.'),
});

const METER_PROMPT = `Cette photo montre un compteur électrique (souvent un sous-compteur mécanique à tambours).
Lis l'index affiché. Sur ces compteurs, les tambours noirs donnent la partie entière en kWh et le dernier tambour
(rouge ou encadré) donne les dixièmes. Recopie les chiffres tels qu'ils apparaissent, sans corriger ni compléter.
Si un tambour de la partie entière est entre deux chiffres, indique le chiffre inférieur (celui qui s'en va) et signale-le.
L'image peut aussi être une capture d'écran (WhatsApp, galerie) avec une date ou une heure : relève-les seulement si elles
sont lisibles, sans inventer l'année. Si l'image n'est pas un compteur ou que l'index est illisible, laisse les chiffres vides
et mets une confiance basse.`;

const BillOutput = z.object({
  periodStart: z.string().describe('Date de l’ancien index (début de période), format AAAA-MM-JJ. Vide si absente.'),
  periodEnd: z.string().describe('Date du nouvel index (fin de période), format AAAA-MM-JJ. Vide si absente.'),
  days: z.number().nullable().describe('« Nombre de jours de consommation » pour l’électricité.'),
  previousIndex: z.number().nullable().describe('Ancien index électricité, tel qu’imprimé.'),
  currentIndex: z.number().nullable().describe('Nouvel index électricité, tel qu’imprimé.'),
  electricityKwh: z.number().nullable().describe('« Consommation totale » électricité en kWh, telle qu’imprimée.'),
  electricityAmount: z.number().nullable().describe('« MONTANT ELEC » net à payer pour l’électricité, en Ariary.'),
  waterAmount: z.number().nullable().describe('« MONTANT EAU » net à payer pour l’eau, en Ariary.'),
  totalAmount: z.number().nullable().describe('« NET A PAYER » de la facture, en Ariary.'),
  invoiceNumber: z.string().describe('Numéro de facture. Vide si absent.'),
  invoiceDate: z.string().describe('Date d’édition, AAAA-MM-JJ. Vide si absente.'),
  dueDate: z.string().describe('Date limite de paiement, AAAA-MM-JJ. Vide si absente.'),
  confidence: z.number().describe('Confiance globale de 0 à 1.'),
  observations: z.string().describe('Remarques en français : valeurs douteuses, incohérences constatées.'),
});

const BILL_PROMPT = `Cette image (ou ce PDF) est une facture JIRAMA (Madagascar) électricité et eau.
Relève les champs demandés tels qu'ils sont imprimés. Les montants utilisent la virgule comme séparateur de milliers
et le point pour les décimales (328,798.76 = 328798.76) : renvoie des nombres. Les dates JJ/MM/AA deviennent AAAA-MM-JJ (années 20AA).
Ne corrige aucune valeur pour la rendre cohérente : si les index ne correspondent pas à la consommation facturée,
recopie quand même les deux et signale l'écart dans les observations.`;

type FileBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: ImageType; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

function fileBlock(file: Buffer, mimeType: string | undefined, allowPdf: boolean): FileBlock | { unsupported: string } {
  if (file.length > MAX_IMAGE_BYTES) return { unsupported: 'Fichier trop lourd pour la lecture automatique (> 5 Mo) : saisissez les valeurs.' };
  if (mimeType === 'application/pdf' && allowPdf) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.toString('base64') } };
  }
  if (mimeType && (IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    return { type: 'image', source: { type: 'base64', media_type: mimeType as ImageType, data: file.toString('base64') } };
  }
  return { unsupported: `Format ${mimeType ?? 'inconnu'} non lu automatiquement (JPEG, PNG ou WebP attendus) : saisissez les valeurs.` };
}

abstract class ClaudeExtractor {
  constructor(
    protected readonly client: Anthropic,
    protected readonly model: string,
  ) {}

  protected async ask<T extends z.ZodType>(block: FileBlock, prompt: string, schema: T): Promise<{ output: z.infer<T> | null; refusal: boolean }> {
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          // Si le modèle principal décline, l'API relance automatiquement sur un modèle de repli.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
          messages: [{ role: 'user', content: [block, { type: 'text', text: prompt }] }],
        },
        { timeout: 90_000 },
      );
      if (response.stop_reason === 'refusal') return { output: null, refusal: true };
      return { output: response.parsed_output ?? null, refusal: false };
    } catch (error) {
      throw new ExtractionError(describeApiError(error));
    }
  }
}

export class ClaudeMeterExtractor extends ClaudeExtractor implements MeterReadingExtractor {
  readonly name = 'claude-vision';

  async extract(file: Buffer, mimeType?: string): Promise<ExtractedMeterReading> {
    const block = fileBlock(file, mimeType, false);
    if ('unsupported' in block) return { warnings: [block.unsupported] };
    const { output, refusal } = await this.ask(block, METER_PROMPT, MeterOutput);
    if (!output) return { warnings: [refusal ? 'Lecture automatique refusée par le modèle : saisissez la valeur.' : 'Lecture automatique impossible : saisissez la valeur.'] };

    const warnings: string[] = [];
    const result: ExtractedMeterReading = {
      confidence: Math.min(1, Math.max(0, output.confidence)),
      rawText: [output.integerDigits, output.tenthsDigit && `dixièmes ${output.tenthsDigit}`, output.observations].filter(Boolean).join(' · '),
    };
    if (/^\d{1,9}$/.test(output.integerDigits)) {
      const tenths = /^\d$/.test(output.tenthsDigit) ? Number(output.tenthsDigit) / 10 : 0;
      result.value = Number(output.integerDigits) + tenths;
    }
    if (output.drumInTransition) {
      warnings.push(`Un chiffre est en cours de rotation${output.transitionDetail ? ` (${output.transitionDetail})` : ''} : vérifiez la valeur sur la photo.`);
    }
    if (output.dateDay && output.dateMonth) {
      const year = output.dateYear ?? new Date().getFullYear();
      if (!output.dateYear) warnings.push(`Année non visible sur la photo : ${year} est supposée.`);
      const date = `${year}-${String(output.dateMonth).padStart(2, '0')}-${String(output.dateDay).padStart(2, '0')}`;
      if (isValidDate(date)) result.date = date;
    }
    if (output.time && isValidTime(output.time)) result.time = output.time;
    if (warnings.length) result.warnings = warnings;
    return result;
  }
}

export class ClaudeBillExtractor extends ClaudeExtractor implements BillExtractor {
  readonly name = 'claude-vision';

  async extract(file: Buffer, mimeType?: string): Promise<ExtractedBill> {
    const block = fileBlock(file, mimeType, true);
    if ('unsupported' in block) return { warnings: [block.unsupported] };
    const { output, refusal } = await this.ask(block, BILL_PROMPT, BillOutput);
    if (!output) return { warnings: [refusal ? 'Lecture automatique refusée par le modèle : saisissez la facture.' : 'Lecture automatique impossible : saisissez la facture.'] };

    const result: ExtractedBill = { confidence: Math.min(1, Math.max(0, output.confidence)), rawText: output.observations };
    const dates = { periodStart: output.periodStart, periodEnd: output.periodEnd, invoiceDate: output.invoiceDate, dueDate: output.dueDate };
    for (const [key, value] of Object.entries(dates) as [keyof typeof dates, string][]) {
      if (value && isValidDate(value)) result[key] = value;
    }
    const numbers = {
      days: output.days,
      previousIndex: output.previousIndex,
      currentIndex: output.currentIndex,
      electricityKwh: output.electricityKwh,
      electricityAmount: output.electricityAmount,
      waterAmount: output.waterAmount,
      totalAmount: output.totalAmount,
    };
    for (const [key, value] of Object.entries(numbers) as [keyof typeof numbers, number | null][]) {
      if (value !== null && Number.isFinite(value) && value >= 0) result[key] = value;
    }
    if (output.invoiceNumber.trim()) result.invoiceNumber = output.invoiceNumber.trim();
    const warnings = billConsistencyWarnings(result);
    if (warnings.length) result.warnings = warnings;
    return result;
  }
}

function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'Clé API Anthropic invalide : lecture automatique indisponible.';
  if (error instanceof Anthropic.RateLimitError) return 'Lecture automatique momentanément saturée : réessayez plus tard ou saisissez la valeur.';
  if (error instanceof Anthropic.BadRequestError) return `Image refusée par le service de lecture : ${error.message}`;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'Délai dépassé pour la lecture automatique : saisissez la valeur.';
  if (error instanceof Anthropic.APIConnectionError) return 'Service de lecture injoignable : saisissez la valeur.';
  if (error instanceof Anthropic.APIError) return `Erreur du service de lecture (${error.status ?? '?'}) : saisissez la valeur.`;
  return 'Lecture automatique impossible : saisissez la valeur.';
}
