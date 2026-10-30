import { formatDateFr } from '@shared/billing/dates';

export { formatDateFr, formatDateTimeFr } from '@shared/billing/dates';
export { formatAriary, formatIndex, formatKwh, formatNumber, formatPercent } from '@shared/billing/format';

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Indian/Antananarivo' });
const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Horodatage ISO (création, validation…) affiché à l'heure de Madagascar. */
export function formatTimestamp(iso: string | null | undefined): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—';
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDateFr(start)} → ${formatDateFr(end)}`;
}

/** Mois de facturation lisible (ex. « sept. 2026 ») à partir de la fin de période. */
export function formatBillMonth(periodEnd: string): string {
  return monthFormat.format(new Date(`${periodEnd}T00:00:00Z`));
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
