/**
 * Détection du type réel d'un fichier par sa signature (« magic bytes ») : le type annoncé par le
 * navigateur n'est jamais pris pour argent comptant.
 */

export type SniffedType = { mime: string; ext: string; kind: 'image' | 'pdf' };

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function sniffFileType(data: Buffer): SniffedType | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png', kind: 'image' };
  }
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  }
  if (data.toString('ascii', 4, 8) === 'ftyp' && HEIF_BRANDS.has(data.toString('ascii', 8, 12))) {
    return { mime: 'image/heic', ext: 'heic', kind: 'image' };
  }
  if (data.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
  return null;
}
