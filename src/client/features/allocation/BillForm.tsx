import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { BillDto } from '@shared/api';
import { daysBetween, isValidDate, toEpochSeconds } from '@shared/billing/dates';
import { BillSchema } from '@shared/schemas';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { type MessageKey, useT } from '@/i18n';
import { formatAriary, formatIndex, formatKwh } from '@/lib/format';

const FormSchema = z.object({
  periodStart: z.string().refine(isValidDate, 'Date invalide'),
  periodEnd: z.string().refine(isValidDate, 'Date invalide'),
  days: z.string().trim().min(1, 'Champ obligatoire'),
  mainMeterPreviousIndex: z.string().trim(),
  mainMeterCurrentIndex: z.string().trim(),
  electricityKwh: z.string().trim().min(1, 'Champ obligatoire'),
  electricityAmount: z.string().trim().min(1, 'Champ obligatoire'),
  waterAmount: z.string().trim(),
  totalAmount: z.string().trim().min(1, 'Champ obligatoire'),
  invoiceNumber: z.string().trim().max(60),
  invoiceDate: z.string(),
  dueDate: z.string(),
  notes: z.string().max(2000),
});

export type BillFormValues = z.infer<typeof FormSchema>;
export type BillPayload = Omit<z.input<typeof BillSchema>, 'documentFileIds' | 'extracted' | 'status'>;

const NUMERIC_FIELDS = ['days', 'mainMeterPreviousIndex', 'mainMeterCurrentIndex', 'electricityKwh', 'electricityAmount', 'waterAmount', 'totalAmount'] as const;

/**
 * Lit un nombre saisi « à la française » (328 798,76) ou recopié d'une facture JIRAMA (328,798.76).
 * Renvoie null si vide, NaN si illisible.
 */
export function parseDecimal(text: string): number | null {
  let cleaned = text.replace(/[\s\u00a0\u202f]/g, '');
  if (cleaned === '') return null;
  cleaned = cleaned.includes(',') && cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

export const EMPTY_BILL_FORM: BillFormValues = {
  periodStart: '',
  periodEnd: '',
  days: '',
  mainMeterPreviousIndex: '',
  mainMeterCurrentIndex: '',
  electricityKwh: '',
  electricityAmount: '',
  waterAmount: '0',
  totalAmount: '',
  invoiceNumber: '',
  invoiceDate: '',
  dueDate: '',
  notes: '',
};

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

export function billToFormValues(bill: BillDto): BillFormValues {
  return {
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    days: String(bill.days),
    mainMeterPreviousIndex: text(bill.mainMeterPreviousIndex),
    mainMeterCurrentIndex: text(bill.mainMeterCurrentIndex),
    electricityKwh: String(bill.electricityKwh),
    electricityAmount: String(bill.electricityAmount),
    waterAmount: String(bill.waterAmount),
    totalAmount: String(bill.totalAmount),
    invoiceNumber: bill.invoiceNumber ?? '',
    invoiceDate: bill.invoiceDate ?? '',
    dueDate: bill.dueDate ?? '',
    notes: bill.notes ?? '',
  };
}

function periodDays(start: string, end: string): number | null {
  if (!isValidDate(start) || !isValidDate(end) || toEpochSeconds(end) <= toEpochSeconds(start)) return null;
  return daysBetween(start, end);
}

/** Alertes de cohérence affichées pendant la saisie (elles n'empêchent pas d'enregistrer la facture telle qu'imprimée). */
export function BillConsistencyAlerts({ values }: { values: Pick<BillFormValues, 'mainMeterPreviousIndex' | 'mainMeterCurrentIndex' | 'electricityKwh' | 'electricityAmount' | 'waterAmount' | 'totalAmount'> }) {
  const t = useT();
  const previous = parseDecimal(values.mainMeterPreviousIndex);
  const current = parseDecimal(values.mainMeterCurrentIndex);
  const kwh = parseDecimal(values.electricityKwh);
  const electricity = parseDecimal(values.electricityAmount);
  const water = parseDecimal(values.waterAmount) ?? 0;
  const total = parseDecimal(values.totalAmount);
  const alerts: string[] = [];
  if (previous !== null && current !== null && kwh !== null && [previous, current, kwh].every(Number.isFinite)) {
    const indexKwh = Math.round((current - previous) * 1000) / 1000;
    if (indexKwh !== kwh) {
      alerts.push(
        t('bills.warning.indexMismatch', { indexKwh: formatKwh(indexKwh), current: formatIndex(current), previous: formatIndex(previous), billedKwh: formatKwh(kwh) }),
      );
    }
  }
  if (electricity !== null && total !== null && [electricity, water, total].every(Number.isFinite)) {
    const sum = Math.round((electricity + water) * 100) / 100;
    if (Math.round(sum * 100) !== Math.round(total * 100)) {
      alerts.push(t('bills.warning.totalMismatch', { sum: formatAriary(sum), total: formatAriary(total) }));
    }
  }
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {alerts.map((message) => (
        <Alert key={message} variant="warning">
          {message}
        </Alert>
      ))}
    </div>
  );
}

/** Formulaire de facture (création et modification). */
export function BillForm({
  defaultValues = EMPTY_BILL_FORM,
  prefill,
  submitLabel,
  busy = false,
  onSubmit,
}: {
  defaultValues?: BillFormValues;
  prefill?: Partial<BillFormValues> | null;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (payload: BillPayload) => void | Promise<void>;
}) {
  const t = useT();
  const form = useForm<BillFormValues>({ resolver: zodResolver(FormSchema), defaultValues });
  const { register, setValue, getValues, getFieldState, formState, watch } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!prefill) return;
    for (const [key, value] of Object.entries(prefill) as [keyof BillFormValues, string | undefined][]) {
      if (value !== undefined) setValue(key, value, { shouldDirty: true, shouldValidate: true });
    }
  }, [prefill, setValue]);

  // Propositions automatiques tant que l'utilisateur n'a pas saisi lui-même ces champs.
  const suggestDays = () => {
    const days = periodDays(getValues('periodStart'), getValues('periodEnd'));
    if (days !== null && !getFieldState('days').isDirty) setValue('days', String(days), { shouldValidate: true });
  };
  const suggestTotal = () => {
    const electricity = parseDecimal(getValues('electricityAmount'));
    const water = parseDecimal(getValues('waterAmount')) ?? 0;
    if (electricity !== null && Number.isFinite(electricity) && Number.isFinite(water) && !getFieldState('totalAmount').isDirty) {
      setValue('totalAmount', String(Math.round((electricity + water) * 100) / 100), { shouldValidate: true });
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const numbers: Partial<Record<(typeof NUMERIC_FIELDS)[number], number | null>> = {};
    let invalid = false;
    for (const field of NUMERIC_FIELDS) {
      const parsed = parseDecimal(values[field]);
      if (Number.isNaN(parsed)) {
        form.setError(field, { message: t('bills.field.number') });
        invalid = true;
      }
      numbers[field] = parsed;
    }
    if (invalid) return;
    const payload: BillPayload = {
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      days: numbers.days ?? Number.NaN,
      mainMeterPreviousIndex: numbers.mainMeterPreviousIndex ?? null,
      mainMeterCurrentIndex: numbers.mainMeterCurrentIndex ?? null,
      electricityKwh: numbers.electricityKwh ?? Number.NaN,
      electricityAmount: numbers.electricityAmount ?? Number.NaN,
      waterAmount: numbers.waterAmount ?? 0,
      totalAmount: numbers.totalAmount ?? Number.NaN,
      invoiceNumber: values.invoiceNumber || null,
      invoiceDate: values.invoiceDate || null,
      dueDate: values.dueDate || null,
      notes: values.notes || null,
    };
    const check = BillSchema.safeParse(payload);
    if (!check.success) {
      for (const issue of check.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && field in values) form.setError(field as keyof BillFormValues, { message: issue.message });
      }
      return;
    }
    await onSubmit(payload);
  });

  const numberField = (name: (typeof NUMERIC_FIELDS)[number], label: MessageKey, hint?: MessageKey, onChange?: () => void) => (
    <Field label={t(label)} htmlFor={`bill-${name}`} error={errors[name]?.message} hint={hint ? t(hint) : undefined}>
      <Input
        id={`bill-${name}`}
        inputMode="decimal"
        autoComplete="off"
        className="tabular"
        aria-invalid={Boolean(errors[name])}
        {...register(name, onChange ? { onChange } : {})}
      />
    </Field>
  );

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t('bills.section.period')}</legend>
        <Field label={t('bills.field.periodStart')} htmlFor="bill-periodStart" error={errors.periodStart?.message}>
          <Input id="bill-periodStart" type="date" aria-invalid={Boolean(errors.periodStart)} {...register('periodStart', { onChange: suggestDays })} />
        </Field>
        <Field label={t('bills.field.periodEnd')} htmlFor="bill-periodEnd" error={errors.periodEnd?.message}>
          <Input id="bill-periodEnd" type="date" aria-invalid={Boolean(errors.periodEnd)} {...register('periodEnd', { onChange: suggestDays })} />
        </Field>
        {numberField('days', 'bills.field.days', 'bills.field.daysHint')}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t('bills.section.meter')}</legend>
        {numberField('mainMeterPreviousIndex', 'bills.field.previousIndex')}
        {numberField('mainMeterCurrentIndex', 'bills.field.currentIndex')}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t('bills.section.amounts')}</legend>
        {numberField('electricityKwh', 'bills.field.kwh')}
        {numberField('electricityAmount', 'bills.field.electricityAmount', 'bills.field.electricityHint', suggestTotal)}
        {numberField('waterAmount', 'bills.field.waterAmount', undefined, suggestTotal)}
        {numberField('totalAmount', 'bills.field.totalAmount', 'bills.field.totalHint')}
      </fieldset>

      <BillConsistencyAlerts values={watch()} />

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t('bills.section.invoice')}</legend>
        <Field label={`${t('bills.field.invoiceNumber')} (${t('state.optional')})`} htmlFor="bill-invoiceNumber" error={errors.invoiceNumber?.message}>
          <Input id="bill-invoiceNumber" autoComplete="off" {...register('invoiceNumber')} />
        </Field>
        <Field label={`${t('bills.field.invoiceDate')} (${t('state.optional')})`} htmlFor="bill-invoiceDate" error={errors.invoiceDate?.message}>
          <Input id="bill-invoiceDate" type="date" {...register('invoiceDate')} />
        </Field>
        <Field label={`${t('bills.field.dueDate')} (${t('state.optional')})`} htmlFor="bill-dueDate" error={errors.dueDate?.message}>
          <Input id="bill-dueDate" type="date" {...register('dueDate')} />
        </Field>
        <Field label={`${t('bills.field.notes')} (${t('state.optional')})`} htmlFor="bill-notes" className="sm:col-span-3">
          <Textarea id="bill-notes" rows={2} {...register('notes')} />
        </Field>
      </fieldset>

      <Button type="submit" size="lg" loading={busy || formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
