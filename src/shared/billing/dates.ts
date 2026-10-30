/**
 * Dates « calendaires » sans fuseau horaire. Madagascar (UTC+3) n'applique pas d'heure d'été :
 * traiter date + heure comme une heure locale naïve donne des durées exactes et reproductibles,
 * quel que soit le fuseau du serveur ou du navigateur.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export const SECONDS_PER_DAY = 86_400;

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** Secondes écoulées depuis l'époque pour une date/heure locale naïve. Sans heure : minuit. */
export function toEpochSeconds(date: string, time?: string | null): number {
  const m = DATE_RE.exec(date);
  if (!m || !isValidDate(date)) throw new RangeError(`Date invalide : ${date}`);
  let h = 0;
  let mi = 0;
  let s = 0;
  if (time) {
    const t = TIME_RE.exec(time);
    if (!t) throw new RangeError(`Heure invalide : ${time}`);
    h = Number(t[1]);
    mi = Number(t[2]);
    s = Number(t[3] ?? 0);
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, s) / 1000;
}

/** Nombre de jours calendaires entre deux dates (27/08 → 26/09 = 30). */
export function daysBetween(start: string, end: string): number {
  return Math.round((toEpochSeconds(end) - toEpochSeconds(start)) / SECONDS_PER_DAY);
}

export function addDays(date: string, days: number): string {
  const d = new Date(toEpochSeconds(date) * 1000 + days * SECONDS_PER_DAY * 1000);
  return d.toISOString().slice(0, 10);
}

export function formatDateFr(date: string): string {
  const m = DATE_RE.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

export function formatTime(time: string): string {
  return time.slice(0, 5);
}

export function formatDateTimeFr(date: string, time?: string | null): string {
  return time ? `${formatDateFr(date)} ${formatTime(time)}` : formatDateFr(date);
}
