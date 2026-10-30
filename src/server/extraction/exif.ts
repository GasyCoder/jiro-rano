import exifr from 'exifr';
import type { ExtractedMeterReading, MeterReadingExtractor } from './types';

/**
 * Date et heure de prise de vue lues dans les métadonnées EXIF (JPEG, HEIC…).
 * Déterministe et sans IA. Les photos transférées par WhatsApp n'ont généralement plus d'EXIF.
 */
export class ExifMeterExtractor implements MeterReadingExtractor {
  readonly name = 'exif';

  async extract(file: Buffer): Promise<ExtractedMeterReading> {
    let tags: Record<string, unknown> | undefined;
    try {
      // reviveValues: false → chaîne brute « 2026:09:24 21:05:57 », sans conversion de fuseau horaire.
      tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false });
    } catch {
      return {};
    }
    const raw = typeof tags?.DateTimeOriginal === 'string' ? tags.DateTimeOriginal : typeof tags?.CreateDate === 'string' ? tags.CreateDate : null;
    const match = raw ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
    if (!match) return {};
    return {
      date: `${match[1]}-${match[2]}-${match[3]}`,
      time: `${match[4]}:${match[5]}:${match[6]}`,
      confidence: 0.95,
      rawText: `EXIF DateTimeOriginal ${raw}`,
    };
  }
}
