import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AllocationDetailDto, BillDto, BuildingDto, ReadingDto } from '@shared/api';
import { AllocationStatusBadge, ProvenanceBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/form';
import { Table, TBody, TD, TFoot, TH, THead, TR } from '@/components/ui/table';
import { CalculationSteps } from '@/features/allocation/CalculationDetails';
import { useAllocation, useBill } from '@/features/allocation/hooks';
import { rowsFromItems, totalsOf } from '@/features/allocation/rows';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatAriary, formatDateFr, formatDateTimeFr, formatIndex, formatKwh, formatNumber, formatPercent, formatPeriod, formatTimestamp } from '@/lib/format';
import { queryKeys } from '@/lib/query';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 break-inside-avoid-page">
      <h2 className="border-b border-slate-300 pb-1 text-sm font-semibold tracking-wide text-slate-800 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function ReadingCell({ reading }: { reading: ReadingDto | undefined }) {
  if (!reading) return <span className="text-slate-400">—</span>;
  return (
    <span className="tabular">
      <strong>{formatIndex(reading.normalizedValue)}</strong>
      {reading.value !== reading.normalizedValue ? <span className="text-slate-500"> ({formatIndex(reading.value)})</span> : null}
      <span className="block text-xs text-slate-500">{formatDateTimeFr(reading.readingDate, reading.readingTime)}</span>
    </span>
  );
}

function Report({ allocation, bill, building }: { allocation: AllocationDetailDto; bill: BillDto; building: BuildingDto | undefined }) {
  const t = useT();
  const [withPhotos, setWithPhotos] = useState(false);
  const rows = rowsFromItems(allocation.items);
  const totals = totalsOf(rows);
  const readingsById = new Map(allocation.readings.map((r) => [r.id, r]));
  const meteredItems = [...allocation.items].sort((a, b) => a.order - b.order).filter((i) => i.readingStartId || i.readingEndId);
  const names = new Map(allocation.items.map((i) => [i.consumerId, i.consumerName]));
  const official = allocation.status === 'VALIDATED' || allocation.status === 'LOCKED';
  const photos = [
    ...bill.documents.filter((d) => d.mimeType.startsWith('image/') && d.mimeType !== 'image/heic').map((d) => ({ id: d.id, url: d.url, caption: t('report.bill') })),
    ...allocation.readings
      .filter((r) => r.photoUrl)
      .map((r) => ({ id: r.id, url: r.photoUrl as string, caption: `${formatIndex(r.value)} — ${formatDateTimeFr(r.readingDate, r.readingTime)}` })),
  ];

  return (
    <div className="min-h-dvh bg-slate-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link to={`/bills/${bill.id}`} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" /> {t('report.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label={t('report.includePhotos')} checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
          <Button onClick={() => window.print()}>
            <Printer /> {t('report.print')}
          </Button>
        </div>
      </div>

      <article className="mx-auto my-6 flex max-w-[210mm] flex-col gap-6 bg-white p-6 text-[13px] text-slate-900 shadow-sm sm:p-10 print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-col gap-1 border-b-2 border-slate-800 pb-3">
          <p className="text-xs text-slate-500">{t('app.name')}</p>
          <h1 className="text-xl font-bold">{t('report.title')}</h1>
          <p className="text-base font-medium">{building?.name ?? ''}</p>
          {building?.address ? <p className="text-slate-600">{building.address}</p> : null}
          <p className="flex flex-wrap items-center gap-2">
            <span>
              {t('bills.detail.period')} : {formatPeriod(bill.periodStart, bill.periodEnd)} ({t('bills.detail.days', { days: bill.days })})
            </span>
            <AllocationStatusBadge status={allocation.status} />
          </p>
        </header>

        {!official ? <Alert variant="warning">{t('report.notValidated')}</Alert> : null}

        <Section title={t('report.bill')}>
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {bill.invoiceNumber ? (
              <div>
                <dt className="text-xs text-slate-500">{t('bills.field.invoiceNumber')}</dt>
                <dd>{bill.invoiceNumber}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-slate-500">{t('bills.detail.mainMeter')}</dt>
              <dd>
                {bill.mainMeterPreviousIndex !== null && bill.mainMeterCurrentIndex !== null
                  ? `${formatIndex(bill.mainMeterPreviousIndex)} → ${formatIndex(bill.mainMeterCurrentIndex)}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('bills.detail.kwh')}</dt>
              <dd>{formatKwh(bill.electricityKwh)} kWh</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('bills.detail.electricity')}</dt>
              <dd>{formatAriary(bill.electricityAmount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('bills.detail.water')}</dt>
              <dd>{formatAriary(bill.waterAmount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('bills.detail.total')}</dt>
              <dd className="font-semibold">{formatAriary(bill.totalAmount)}</dd>
            </div>
            {bill.dueDate ? (
              <div>
                <dt className="text-xs text-slate-500">{t('bills.field.dueDate')}</dt>
                <dd>{formatDateFr(bill.dueDate)}</dd>
              </div>
            ) : null}
          </dl>
        </Section>

        <Section title={t('report.allocation')}>
          <Table className="text-[12px]">
            <THead>
              <TR>
                <TH>{t('allocation.table.consumer')}</TH>
                <TH>{t('allocation.table.method')}</TH>
                <TH className="text-right">{t('allocation.table.kwh')}</TH>
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
                  <TD className="font-medium">{row.name}</TD>
                  <TD>
                    <span className="flex flex-col items-start gap-1">
                      <ProvenanceBadge provenance={row.provenance} />
                      <span className="text-xs text-slate-500">{t(`allocation.applied.${row.appliedMethod}`)}</span>
                    </span>
                  </TD>
                  <TD className="tabular text-right">{formatKwh(row.kwh)}</TD>
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
                <TD colSpan={2}>{t('allocation.table.totalRow')}</TD>
                <TD className="tabular text-right">{formatKwh(totals.kwh)}</TD>
                <TD className="tabular text-right">{formatPercent(totals.ratio)}</TD>
                <TD className="tabular text-right">{formatAriary(totals.electricityAmount)}</TD>
                <TD className="tabular text-right">{formatAriary(totals.waterAmount)}</TD>
                <TD className="tabular text-right">{formatAriary(totals.totalAmount)}</TD>
                <TD className="tabular text-right">{formatAriary(totals.payableAmount, 0)}</TD>
              </TR>
            </TFoot>
          </Table>
          {allocation.effectivePricePerKwh !== null ? (
            <p className="text-xs text-slate-600">
              {t('allocation.effectivePrice', { price: formatNumber(allocation.effectivePricePerKwh, 2) })} {t('allocation.payableNote')}
            </p>
          ) : null}
        </Section>

        <Section title={t('report.readings')}>
          {meteredItems.length === 0 ? (
            <p className="text-slate-500">{t('report.noReadings')}</p>
          ) : (
            <Table className="text-[12px]">
              <THead>
                <TR>
                  <TH>{t('allocation.table.consumer')}</TH>
                  <TH>{t('report.readingStart')}</TH>
                  <TH>{t('report.readingEnd')}</TH>
                  <TH>{t('allocation.table.kwh')}</TH>
                </TR>
              </THead>
              <TBody>
                {meteredItems.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-medium">
                      {item.consumerName}
                      {item.readingStartId && readingsById.get(item.readingStartId)?.meterLabel ? (
                        <span className="block text-xs font-normal text-slate-500">{readingsById.get(item.readingStartId)?.meterLabel}</span>
                      ) : null}
                    </TD>
                    <TD>
                      <ReadingCell reading={item.readingStartId ? readingsById.get(item.readingStartId) : undefined} />
                    </TD>
                    <TD>
                      <ReadingCell reading={item.readingEndId ? readingsById.get(item.readingEndId) : undefined} />
                    </TD>
                    <TD className="tabular">
                      {item.measuredKwh !== null && item.measuredDays !== null
                        ? t('report.measured', { kwh: formatKwh(item.measuredKwh), days: formatNumber(item.measuredDays, 2) })
                        : '—'}
                      <span className="block text-xs text-slate-500">→ {formatKwh(item.kwh)} kWh</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        {allocation.warnings.length > 0 ? (
          <Section title={t('report.warnings')}>
            <ul className="flex flex-col gap-1">
              {allocation.warnings.map((w, index) => (
                <li key={`${w.code}-${index}`}>• {w.message}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title={t('report.steps')}>
          <CalculationSteps steps={allocation.steps} names={names} />
        </Section>

        <Section title={t('report.status')}>
          <p className="flex flex-wrap items-center gap-2">
            {t('allocation.version', { version: allocation.version })} <AllocationStatusBadge status={allocation.status} />
          </p>
          {allocation.validatedAt ? (
            <p>{t('report.validatedBy', { date: formatTimestamp(allocation.validatedAt), name: allocation.validatedByName ?? '—' })}</p>
          ) : null}
          {allocation.correctionReason ? <p>{t('allocation.correction', { reason: allocation.correctionReason })}</p> : null}
          <p className="text-xs text-slate-500">{t('report.engine', { version: allocation.engineVersion, allocation: allocation.version })}</p>
          <p className="text-xs text-slate-500">{t('report.generatedAt', { date: formatTimestamp(new Date().toISOString()) })}</p>
        </Section>

        {withPhotos && photos.length > 0 ? (
          <Section title={t('report.photos')}>
            <div className="grid grid-cols-2 gap-3">
              {photos.map((photo) => (
                <figure key={photo.id} className="flex flex-col gap-1 break-inside-avoid">
                  <img src={photo.url} alt={photo.caption} className="max-h-72 w-full rounded border border-slate-200 object-contain" />
                  <figcaption className="text-xs text-slate-600">{photo.caption}</figcaption>
                </figure>
              ))}
            </div>
          </Section>
        ) : null}
      </article>
    </div>
  );
}

export default function ReportPage() {
  const t = useT();
  const { allocationId = '' } = useParams();
  const allocationQuery = useAllocation(allocationId);
  const billQuery = useBill(allocationQuery.data?.billId);
  const buildingId = billQuery.data?.buildingId;
  const buildingQuery = useQuery({
    queryKey: queryKeys.building(buildingId ?? 'none'),
    queryFn: () => api<BuildingDto>(`/api/buildings/${buildingId}`),
    enabled: Boolean(buildingId),
  });

  const error = allocationQuery.error ?? billQuery.error;
  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Alert variant="error" title={t('state.error')}>
          {errorMessage(error)}
        </Alert>
      </div>
    );
  }
  if (!allocationQuery.data || !billQuery.data) return <Spinner className="min-h-dvh" />;
  return <Report allocation={allocationQuery.data} bill={billQuery.data} building={buildingQuery.data} />;
}
