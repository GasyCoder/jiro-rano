import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import { ClaudeBillExtractor, ClaudeMeterExtractor } from './anthropic';
import { CompositeMeterExtractor, NoopBillExtractor } from './composite';
import { ExifMeterExtractor } from './exif';
import type { BillExtractor, MeterReadingExtractor } from './types';

export type Extractors = { meter: MeterReadingExtractor; bill: BillExtractor };

/** Sélection du moteur de lecture selon la configuration. EXIF est toujours utilisé pour la date. */
export function createExtractors(env: Pick<Env, 'EXTRACTOR_PROVIDER' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL'>): Extractors {
  const exif = new ExifMeterExtractor();
  if (env.EXTRACTOR_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
    return {
      meter: new CompositeMeterExtractor([new ClaudeMeterExtractor(client, env.ANTHROPIC_MODEL)], exif),
      bill: new ClaudeBillExtractor(client, env.ANTHROPIC_MODEL),
    };
  }
  return { meter: new CompositeMeterExtractor([], exif), bill: new NoopBillExtractor() };
}

export * from './types';
