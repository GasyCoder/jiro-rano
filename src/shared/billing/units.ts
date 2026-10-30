/**
 * Arithmétique entière du moteur : l'énergie est manipulée en Wh, l'argent en centimes d'Ariary.
 * Aucun calcul monétaire n'utilise de flottant au-delà de la conversion d'entrée.
 */

export function toWh(kwh: number): number {
  assertFinite(kwh, 'kWh');
  return Math.round(kwh * 1000);
}

export function whToKwh(wh: number): number {
  return wh / 1000;
}

export function toCentimes(ariary: number): number {
  assertFinite(ariary, 'Ariary');
  return Math.round(ariary * 100);
}

export function centimesToAriary(centimes: number): number {
  return centimes / 100;
}

/** Représentation décimale exacte (pour PostgreSQL numeric) : 32879876 → "328798.76". */
export function centimesToDecimalString(centimes: number): string {
  const sign = centimes < 0 ? '-' : '';
  const abs = Math.abs(centimes);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Représentation décimale exacte d'une valeur en Wh, en kWh à 3 décimales : 293270 → "293.270". */
export function whToDecimalString(wh: number): string {
  const sign = wh < 0 ? '-' : '';
  const abs = Math.abs(wh);
  return `${sign}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** Conversion exacte d'une chaîne décimale PostgreSQL ("328798.76") en entier d'unités mineures. */
export function decimalStringToMinorUnits(value: string, decimals: number): number {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Valeur décimale invalide : ${value}`);
  const [, sign, intPart = '0', fracPart = ''] = match;
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const roundUp = fracPart.length > decimals && Number(fracPart[decimals]) >= 5;
  const units = Number(intPart) * 10 ** decimals + Number(frac || '0') + (roundUp ? 1 : 0);
  return sign ? -units : units;
}

/** a × b ÷ c arrondi au plus proche (demi vers le haut), en entiers exacts. a, b ≥ 0 et c > 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (a < 0 || b < 0 || c <= 0) throw new RangeError('mulDivRound attend a ≥ 0, b ≥ 0, c > 0');
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return Number((num * 2n + den) / (den * 2n));
}

/**
 * Répartit un total entier proportionnellement à des poids entiers, sans perte :
 * la somme des parts est exactement égale au total (méthode du plus fort reste / Hamilton).
 * En cas d'égalité de reste, l'ordre d'entrée décide : le résultat est déterministe.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError('Le total à répartir doit être un entier positif');
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) throw new RangeError('Les poids doivent être des entiers positifs');
  const weightSum = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (weightSum === 0n) {
    if (total === 0) return weights.map(() => 0);
    throw new RangeError('Impossible de répartir un total non nul avec des poids tous nuls');
  }
  const bigTotal = BigInt(total);
  const shares = weights.map((w) => (bigTotal * BigInt(w)) / weightSum);
  const remainders = weights.map((w, index) => ({ index, rest: (bigTotal * BigInt(w)) % weightSum }));
  let left = total - Number(shares.reduce((sum, s) => sum + s, 0n));
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left <= 0) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    left -= 1;
  }
  return shares.map(Number);
}

/** Convertit un coefficient décimal (0,8 ; 1,25…) en poids entier stable. */
export function weightToInt(weight: number): number {
  return Math.round(weight * 1_000_000);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} invalide : ${value}`);
}
