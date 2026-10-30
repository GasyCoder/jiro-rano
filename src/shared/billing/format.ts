/**
 * Formatage français déterministe (indépendant des données ICU du runtime) :
 * séparateur de milliers = espace, séparateur décimal = virgule.
 */

export function formatNumber(value: number, decimals: number, group = true): string {
  const negative = value < 0;
  const fixed = roundHalfUp(Math.abs(value), decimals).toFixed(decimals);
  const [intPart = '0', fracPart] = fixed.split('.');
  const grouped = group ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : intPart;
  return `${negative ? '-' : ''}${grouped}${fracPart ? `,${fracPart}` : ''}`;
}

/** kWh à partir de Wh : entier si exact, sinon 2 décimales (arrondi entier exact : 131 295 Wh → 131,30). */
export function formatKwhFromWh(wh: number): string {
  if (wh % 1000 === 0) return formatNumber(wh / 1000, 0);
  const sign = wh < 0 ? -1 : 1;
  const centiKwh = Math.floor((Math.abs(wh) + 5) / 10);
  return formatNumber((sign * centiKwh) / 100, 2);
}

export function formatKwh(kwh: number): string {
  return formatNumber(kwh, Number.isInteger(kwh) ? 0 : 2);
}

/** Index de compteur : pas de séparateur de milliers (4801, 8073,3). */
export function formatIndex(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : countDecimals(value), false);
}

export function formatAriaryFromCentimes(centimes: number): string {
  return `${formatNumber(centimes / 100, 2)} Ar`;
}

export function formatAriary(amount: number, decimals = 2): string {
  return `${formatNumber(amount, decimals)} Ar`;
}

export function formatPercent(ratio: number, decimals = 2): string {
  return `${formatNumber(ratio * 100, decimals)} %`;
}

/** Arrondi décimal sans erreur binaire : 131.295 → 131.30 (et non 131.29). */
function roundHalfUp(value: number, decimals: number): number {
  const shifted = Number(`${value}e${decimals}`);
  if (!Number.isFinite(shifted)) return Math.round(value * 10 ** decimals) / 10 ** decimals;
  return Number(`${Math.round(shifted)}e-${decimals}`);
}

function countDecimals(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 3);
}
