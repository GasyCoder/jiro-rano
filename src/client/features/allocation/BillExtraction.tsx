import { useState } from 'react';
import type { ExtractedBillDto, UploadResultDto } from '@shared/api';
import { PhotoUpload } from '@/components/photo-upload';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { type MessageKey, useT } from '@/i18n';
import { formatAriary, formatDateFr, formatIndex, formatKwh, formatPercent } from '@/lib/format';
import type { BillFormValues } from './BillForm';

type Row = { label: MessageKey; value: string };

function detectedRows(bill: ExtractedBillDto): Row[] {
  const rows: (Row | null)[] = [
    bill.periodStart ? { label: 'bills.field.periodStart', value: formatDateFr(bill.periodStart) } : null,
    bill.periodEnd ? { label: 'bills.field.periodEnd', value: formatDateFr(bill.periodEnd) } : null,
    bill.days !== undefined ? { label: 'bills.field.days', value: String(bill.days) } : null,
    bill.previousIndex !== undefined ? { label: 'bills.field.previousIndex', value: formatIndex(bill.previousIndex) } : null,
    bill.currentIndex !== undefined ? { label: 'bills.field.currentIndex', value: formatIndex(bill.currentIndex) } : null,
    bill.electricityKwh !== undefined ? { label: 'bills.field.kwh', value: formatKwh(bill.electricityKwh) } : null,
    bill.electricityAmount !== undefined ? { label: 'bills.field.electricityAmount', value: formatAriary(bill.electricityAmount) } : null,
    bill.waterAmount !== undefined ? { label: 'bills.field.waterAmount', value: formatAriary(bill.waterAmount) } : null,
    bill.totalAmount !== undefined ? { label: 'bills.field.totalAmount', value: formatAriary(bill.totalAmount) } : null,
    bill.invoiceNumber ? { label: 'bills.field.invoiceNumber', value: bill.invoiceNumber } : null,
    bill.invoiceDate ? { label: 'bills.field.invoiceDate', value: formatDateFr(bill.invoiceDate) } : null,
    bill.dueDate ? { label: 'bills.field.dueDate', value: formatDateFr(bill.dueDate) } : null,
  ];
  return rows.filter((r): r is Row => r !== null);
}

const str = (value: number | undefined) => (value === undefined ? undefined : String(value));

export function extractedToForm(bill: ExtractedBillDto): Partial<BillFormValues> {
  const values: Partial<BillFormValues> = {
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    days: str(bill.days),
    mainMeterPreviousIndex: str(bill.previousIndex),
    mainMeterCurrentIndex: str(bill.currentIndex),
    electricityKwh: str(bill.electricityKwh),
    electricityAmount: str(bill.electricityAmount),
    waterAmount: str(bill.waterAmount),
    totalAmount: str(bill.totalAmount),
    invoiceNumber: bill.invoiceNumber,
    invoiceDate: bill.invoiceDate,
    dueDate: bill.dueDate,
  };
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

/**
 * Photo ou PDF de facture : les valeurs détectées sont seulement affichées. Elles ne vont dans le
 * formulaire qu'après un clic explicite, et l'utilisateur les vérifie avant d'enregistrer.
 */
export function BillExtraction({ buildingId, onUploaded, onApply }: { buildingId: string; onUploaded: (fileId: string) => void; onApply: (values: Partial<BillFormValues>) => void }) {
  const t = useT();
  const [result, setResult] = useState<UploadResultDto | null>(null);
  const [applied, setApplied] = useState(false);
  const detected = result?.bill;
  const rows = detected ? detectedRows(detected) : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">{t('bills.photo.hint')}</p>
      <PhotoUpload
        buildingId={buildingId}
        kind="BILL_PHOTO"
        accept="image/*,application/pdf"
        onUploaded={(upload) => {
          setResult(upload);
          setApplied(false);
          onUploaded(upload.file.id);
        }}
      />
      {result ? <Alert variant="success">{t('bills.photo.attached')}</Alert> : null}
      {result && rows.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-950">
            {t('bills.photo.detected')}
            {detected?.confidence !== undefined ? ` · ${t('bills.photo.confidence', { percent: formatPercent(detected.confidence, 0) })}` : ''}
          </p>
          <dl className="tabular grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-2">
                <dt className="text-slate-600">{t(row.label)}</dt>
                <dd className="font-medium text-slate-900">{row.value}</dd>
              </div>
            ))}
          </dl>
          {detected?.warnings?.map((w) => (
            <p key={w} className="text-sm text-amber-950">
              • {w}
            </p>
          ))}
          {applied ? (
            <Alert variant="info">{t('bills.photo.applied')}</Alert>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                if (detected) onApply(extractedToForm(detected));
                setApplied(true);
              }}
            >
              {t('bills.photo.apply')}
            </Button>
          )}
        </div>
      ) : result ? (
        <Alert variant="info">
          {result.extractionError ?? t('bills.photo.none')}
          {detected?.warnings?.map((w) => (
            <p key={w}>• {w}</p>
          ))}
        </Alert>
      ) : null}
    </div>
  );
}
