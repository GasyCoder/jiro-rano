import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AllocationDetailDto, DashboardDto } from '@shared/api';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT } from '@/i18n';
import { formatAriary, formatBillMonth, formatKwh, formatPercent } from '@/lib/format';
import {
  axisTick,
  BUILDING_COLOR,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  formatAxisValue,
  formatShortMonth,
  GRID_COLOR,
  MAX_SERIES,
  OTHER_COLOR,
  SURFACE,
} from './chart-kit';

const kwhText = (value: number) => `${formatKwh(value)} kWh`;
const arText = (value: number) => formatAriary(value, 0);
const barCursor = { fill: '#f1f5f9' };

/** Consommation par logement sur la dernière facture : barres horizontales, valeur au bout de chaque barre. */
export function ConsumerKwhChart({ allocation, colors }: { allocation: AllocationDetailDto | null; colors: Map<string, string> }) {
  const t = useT();
  const data = (allocation?.items ?? []).map((item) => ({
    id: item.consumerId,
    name: item.consumerName,
    kwh: item.kwh,
    ratio: item.ratio,
    color: colors.get(item.consumerId) ?? OTHER_COLOR,
  }));
  const height = Math.max(140, data.length * 44 + 16);
  return (
    <ChartCard
      title={t('dashboard.chart.byConsumer')}
      description={t('dashboard.chart.byConsumerHint')}
      empty={data.length === 0}
      chart={
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }} barCategoryGap={12}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="name" width={92} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={axisTick} />
              <Tooltip
                cursor={barCursor}
                content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} format={kwhText} />}
              />
              <Bar dataKey="kwh" name="kWh" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {data.map((entry) => (
                  <Cell key={entry.id} fill={entry.color} />
                ))}
                <LabelList dataKey="kwh" position="right" formatter={(v: unknown) => kwhText(Number(v))} style={{ fill: '#334155', fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <THead>
            <TR>
              <TH>{t('dashboard.col.consumer')}</TH>
              <TH className="text-right">{t('dashboard.col.kwh')}</TH>
              <TH className="text-right">{t('dashboard.col.share')}</TH>
            </TR>
          </THead>
          <TBody>
            {data.map((row) => (
              <TR key={row.id}>
                <TD>{row.name}</TD>
                <TD className="tabular text-right">{formatKwh(row.kwh)}</TD>
                <TD className="tabular text-right">{formatPercent(row.ratio)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}

function MonthTable({ rows, valueLabel, format }: { rows: { key: string; month: string; value: number }[]; valueLabel: string; format: (v: number) => string }) {
  const t = useT();
  return (
    <Table>
      <THead>
        <TR>
          <TH>{t('dashboard.col.month')}</TH>
          <TH className="text-right">{valueLabel}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.key}>
            <TD>{row.month}</TD>
            <TD className="tabular text-right">{format(row.value)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** kWh facturés au bâtiment, mois par mois : une seule série, pas de légende (le titre la nomme). */
export function BuildingKwhChart({ monthly }: { monthly: DashboardDto['monthly'] }) {
  const t = useT();
  const data = monthly.map((m) => ({ key: m.billId, month: formatShortMonth(m.periodEnd), fullMonth: formatBillMonth(m.periodEnd), kwh: m.totalKwh }));
  const latest = data.at(-1);
  return (
    <ChartCard
      title={t('dashboard.chart.buildingKwh')}
      description={latest ? t('dashboard.chart.latest', { value: kwhText(latest.kwh) }) : t('dashboard.chart.buildingKwhHint')}
      empty={data.length === 0}
      chart={
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_COLOR} />
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={axisTick} />
              <YAxis width={52} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={formatAxisValue} />
              <Tooltip
                cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} format={kwhText} />}
              />
              <Line
                type="monotone"
                dataKey="kwh"
                name={t('dashboard.chart.buildingKwh')}
                stroke={BUILDING_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 4, fill: BUILDING_COLOR, stroke: SURFACE, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: BUILDING_COLOR, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      }
      table={<MonthTable rows={data.map((d) => ({ key: d.key, month: d.fullMonth, value: d.kwh }))} valueLabel={t('dashboard.col.kwh')} format={(v) => formatKwh(v)} />}
    />
  );
}

/** Coût total facturé par mois : colonnes d'une seule couleur. */
export function MonthlyCostChart({ monthly }: { monthly: DashboardDto['monthly'] }) {
  const t = useT();
  const data = monthly.map((m) => ({ key: m.billId, month: formatShortMonth(m.periodEnd), fullMonth: formatBillMonth(m.periodEnd), amount: m.totalAmount }));
  const latest = data.at(-1);
  return (
    <ChartCard
      title={t('dashboard.chart.monthlyCost')}
      description={latest ? t('dashboard.chart.latest', { value: arText(latest.amount) }) : t('dashboard.chart.monthlyCostHint')}
      empty={data.length === 0}
      chart={
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_COLOR} />
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={axisTick} />
              <YAxis width={52} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={formatAxisValue} />
              <Tooltip
                cursor={barCursor}
                content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} format={arText} />}
              />
              <Bar dataKey="amount" name={t('dashboard.col.amount')} fill={BUILDING_COLOR} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={<MonthTable rows={data.map((d) => ({ key: d.key, month: d.fullMonth, value: d.amount }))} valueLabel={t('dashboard.col.amount')} format={arText} />}
    />
  );
}

/**
 * kWh attribués à chaque logement, empilés par mois (répartition courante de chaque facture).
 * Au-delà de 8 logements, les suivants sont regroupés en « Autres ».
 */
export function StackedConsumerChart({ monthly, colors, names }: { monthly: DashboardDto['monthly']; colors: Map<string, string>; names: Map<string, string> }) {
  const t = useT();
  const months = monthly.filter((m) => m.perConsumer.length > 0);
  const order = [...colors.keys()];
  const present = new Set(months.flatMap((m) => m.perConsumer.map((p) => p.consumerId)));
  for (const m of months) for (const p of m.perConsumer) if (!colors.has(p.consumerId)) order.push(p.consumerId);
  const visible = order.filter((id) => present.has(id));
  const named = visible.slice(0, MAX_SERIES);
  const folded = new Set(visible.slice(MAX_SERIES));
  const series = [
    ...named.map((id) => ({ key: id, label: names.get(id) ?? months.flatMap((m) => m.perConsumer).find((p) => p.consumerId === id)?.name ?? id, color: colors.get(id) ?? OTHER_COLOR })),
    ...(folded.size > 0 ? [{ key: 'other', label: t('dashboard.chart.other'), color: OTHER_COLOR }] : []),
  ];
  const data = months.map((m) => {
    const row: Record<string, string | number> = { key: m.billId, month: formatShortMonth(m.periodEnd), fullMonth: formatBillMonth(m.periodEnd) };
    for (const p of m.perConsumer) {
      const key = folded.has(p.consumerId) ? 'other' : p.consumerId;
      row[key] = Number(row[key] ?? 0) + p.kwh;
    }
    return row;
  });
  return (
    <ChartCard
      title={t('dashboard.chart.stacked')}
      description={t('dashboard.chart.stackedHint')}
      empty={data.length === 0}
      chart={
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={axisTick} />
                <YAxis width={52} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={formatAxisValue} />
                <Tooltip
                  cursor={barCursor}
                  content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} format={kwhText} />}
                />
                {series.map((s, index) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    stackId="kwh"
                    fill={s.color}
                    stroke={SURFACE}
                    strokeWidth={2}
                    maxBarSize={24}
                    radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend items={series} />
        </>
      }
      table={
        <Table>
          <THead>
            <TR>
              <TH>{t('dashboard.col.month')}</TH>
              {series.map((s) => (
                <TH key={s.key} className="text-right">
                  {s.label}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {data.map((row) => (
              <TR key={String(row.key)}>
                <TD>{row.fullMonth}</TD>
                {series.map((s) => (
                  <TD key={s.key} className="tabular text-right">
                    {row[s.key] !== undefined ? formatKwh(Number(row[s.key])) : '—'}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
