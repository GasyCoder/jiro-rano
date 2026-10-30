import { Table2, BarChart3 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { ConsumerDto } from '@shared/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n';
import { formatNumber } from '@/lib/format';

/**
 * Palette catégorielle de référence (skill dataviz), ordre fixe, validée sur fond blanc :
 * `validate_palette.js --mode light --surface #ffffff` → toutes les vérifications passent ;
 * contraste < 3:1 pour aqua, jaune, magenta → légende + vue tableau obligatoires (fournies).
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;
/** 9e consommateur et suivants : regroupés, jamais une teinte générée. */
export const OTHER_COLOR = '#94a3b8';
/** Séries uniques « bâtiment » (total) : couleur de marque, distincte des logements. */
export const BUILDING_COLOR = '#0f766e';
export const SURFACE = '#ffffff';
export const GRID_COLOR = '#e2e8f0';
export const AXIS_TEXT = '#64748b';
export const MAX_SERIES = SERIES_COLORS.length;

/** La couleur suit le consommateur (ordre du bâtiment), jamais son rang dans un graphique. */
export function consumerColorMap(consumers: ConsumerDto[] | undefined): Map<string, string> {
  const sorted = [...(consumers ?? [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return new Map(sorted.map((c, index) => [c.id, SERIES_COLORS[index] ?? OTHER_COLOR]));
}

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const shortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Graduations : en clair sous 10 000, compactes au-delà (10 k, 300 k). */
export function formatAxisValue(value: number): string {
  return Math.abs(value) >= 10_000 ? compact.format(value) : formatNumber(value, 0);
}

export function formatShortMonth(periodEnd: string): string {
  return shortMonth.format(new Date(`${periodEnd}T00:00:00Z`));
}

export const axisTick = { fill: AXIS_TEXT, fontSize: 12 } as const;

type TooltipEntry = {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
  dataKey?: unknown;
};

/** Info-bulle : la valeur d'abord (forte), le nom ensuite ; repère en trait de la couleur de la série. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((entry) => typeof entry.value === 'number');
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== '' ? <p className="mb-1 text-slate-500">{label}</p> : null}
      <ul className="flex flex-col gap-1">
        {rows.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden />
            <span className="tabular font-semibold text-slate-900">{format(entry.value as number)}</span>
            {rows.length > 1 || entry.name ? <span className="text-slate-500">{entry.name}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Légende (≥ 2 séries) : pastille de la couleur de la marque, texte en encre normale. */
export function ChartLegend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Carte de graphique avec sa vue tableau : toute valeur reste lisible sans survol ni couleur.
 * La hauteur fixe inclut les axes (pas de défilement imbriqué).
 */
export function ChartCard({
  title,
  description,
  chart,
  table,
  empty,
}: {
  title: string;
  description?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  empty?: boolean;
}) {
  const t = useT();
  const [showTable, setShowTable] = useState(false);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {!empty ? (
          <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? <BarChart3 /> : <Table2 />}
            {showTable ? t('dashboard.chart.showChart') : t('dashboard.chart.showTable')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-10 text-center text-sm text-slate-500">{t('dashboard.chart.noData')}</p>
        ) : showTable ? (
          table
        ) : (
          <div role="img" aria-label={title}>
            {chart}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
