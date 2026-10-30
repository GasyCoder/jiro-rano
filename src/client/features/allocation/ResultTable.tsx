import { ProvenanceBadge } from '@/components/badges';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { useT } from '@/i18n';
import { formatAriary, formatKwh, formatPercent } from '@/lib/format';
import { type ResultRow, totalsOf } from './rows';

/** Résultat d'une répartition : cartes empilées sur mobile, tableau complet à partir de md. */
export function ResultTable({ rows, showMethod = false }: { rows: ResultRow[]; showMethod?: boolean }) {
  const t = useT();
  const totals = totalsOf(rows);

  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row.consumerId} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium text-slate-900">{row.name}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ProvenanceBadge provenance={row.provenance} />
                  {showMethod ? <span className="text-xs text-slate-500">{t(`allocation.applied.${row.appliedMethod}`)}</span> : null}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">{t('allocation.table.payable')}</p>
                <p className="tabular text-lg font-semibold whitespace-nowrap text-slate-900">{formatAriary(row.payableAmount, 0)}</p>
              </div>
            </div>
            <dl className="tabular mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">{t('allocation.table.kwh')}</dt>
              <dd className="text-right">
                {formatKwh(row.kwh)} · {formatPercent(row.ratio)}
              </dd>
              <dt className="text-slate-500">{t('allocation.table.electricity')}</dt>
              <dd className="text-right">{formatAriary(row.electricityAmount)}</dd>
              <dt className="text-slate-500">{t('allocation.table.water')}</dt>
              <dd className="text-right">{formatAriary(row.waterAmount)}</dd>
              <dt className="text-slate-500">{t('allocation.table.total')}</dt>
              <dd className="text-right">{formatAriary(row.totalAmount)}</dd>
            </dl>
          </li>
        ))}
        <li className="tabular rounded-lg border-2 border-slate-300 bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between font-semibold">
            <span>{t('allocation.table.totalRow')}</span>
            <span>{formatAriary(totals.payableAmount, 0)}</span>
          </div>
          <p className="mt-1 text-slate-600">
            {formatKwh(totals.kwh)} kWh · {formatAriary(totals.electricityAmount)} + {formatAriary(totals.waterAmount)} = {formatAriary(totals.totalAmount)}
          </p>
        </li>
      </ul>

      <div className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>{t('allocation.table.consumer')}</TH>
              <TH className="text-right">{t('allocation.table.kwh')}</TH>
              <TH>{t('allocation.table.provenance')}</TH>
              <TH className="text-right">{t('allocation.table.share')}</TH>
              <TH className="text-right">{t('allocation.table.electricity')}</TH>
              <TH className="text-right">{t('allocation.table.water')}</TH>
              <TH className="text-right">{t('allocation.table.total')}</TH>
              <TH className="text-right">{t('allocation.table.payable')}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.consumerId}>
                <TD className="font-medium">
                  {row.name}
                  {showMethod ? <span className="block text-xs font-normal text-slate-500">{t(`allocation.applied.${row.appliedMethod}`)}</span> : null}
                </TD>
                <TD className="tabular text-right">{formatKwh(row.kwh)}</TD>
                <TD>
                  <ProvenanceBadge provenance={row.provenance} />
                </TD>
                <TD className="tabular text-right">{formatPercent(row.ratio)}</TD>
                <TD className="tabular text-right">{formatAriary(row.electricityAmount)}</TD>
                <TD className="tabular text-right">{formatAriary(row.waterAmount)}</TD>
                <TD className="tabular text-right">{formatAriary(row.totalAmount)}</TD>
                <TD className="tabular text-right font-semibold">{formatAriary(row.payableAmount, 0)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD>{t('allocation.table.totalRow')}</TD>
              <TD className="tabular text-right">{formatKwh(totals.kwh)}</TD>
              <TD />
              <TD className="tabular text-right">{formatPercent(totals.ratio)}</TD>
              <TD className="tabular text-right">{formatAriary(totals.electricityAmount)}</TD>
              <TD className="tabular text-right">{formatAriary(totals.waterAmount)}</TD>
              <TD className="tabular text-right">{formatAriary(totals.totalAmount)}</TD>
              <TD className="tabular text-right">{formatAriary(totals.payableAmount, 0)}</TD>
            </TR>
          </TFoot>
        </Table>
      </div>
    </>
  );
}
