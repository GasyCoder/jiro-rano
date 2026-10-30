import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { MeterDto, ReadingDto, UploadResultDto } from '@shared/api';
import { normalizeReading, type ReadingSource } from '@shared/domain';
import { dateString } from '@shared/schemas';
import { useCurrentBuilding } from '@/auth/building';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatDateFr, formatIndex, formatPercent, todayIso } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { PhotoUpload } from './photo-upload';
import { Button } from './ui/button';
import { Alert } from './ui/feedback';
import { Field, Input, Textarea } from './ui/form';
import { Tabs } from './ui/tabs';
import { useToast } from './ui/toast';

const FormSchema = z.object({
  value: z.number({ error: 'Index requis' }).finite().min(0, 'Index positif requis').max(1e9),
  readingDate: dateString,
  readingTime: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Heure invalide'),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof FormSchema>;

/**
 * Saisie d'un relevé : à la main, ou depuis une photo dont la valeur détectée est proposée puis
 * confirmée (ou corrigée) par l'utilisateur. Rien n'est enregistré sans ce clic de confirmation.
 */
export function ReadingForm({ meter, defaultDate, onSaved }: { meter: MeterDto; defaultDate?: string; onSaved?: (reading: ReadingDto) => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { buildingId, can } = useCurrentBuilding();
  const [mode, setMode] = useState<'photo' | 'manual'>('photo');
  const [upload, setUpload] = useState<UploadResultDto | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { readingDate: defaultDate ?? todayIso(), readingTime: '', notes: '' },
  });
  const value = form.watch('value');
  const detected = upload?.meterReading;

  const onUploaded = (result: UploadResultDto) => {
    setUpload(result);
    const reading = result.meterReading;
    if (reading?.value !== undefined) form.setValue('value', reading.value, { shouldValidate: true });
    if (reading?.date) form.setValue('readingDate', reading.date, { shouldValidate: true });
    if (reading?.time) form.setValue('readingTime', reading.time, { shouldValidate: true });
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const fromPhoto = mode === 'photo' && upload !== null;
      const source: ReadingSource = !fromPhoto ? 'MANUAL' : detected?.value !== undefined && detected.value === values.value ? 'OCR' : 'IMAGE';
      return api<ReadingDto>(`/api/meters/${meter.id}/readings`, {
        method: 'POST',
        body: {
          value: values.value,
          readingDate: values.readingDate,
          readingTime: values.readingTime || null,
          notes: values.notes || null,
          source,
          photoFileId: fromPhoto ? upload.file.id : null,
          confidenceScore: fromPhoto ? (detected?.confidence ?? null) : null,
          extracted: fromPhoto && detected ? { ...detected, extractor: upload.extractor } : null,
          confirmed: true,
        },
      });
    },
    onSuccess: async (reading) => {
      toast.success(reading.validated ? t('reading.form.saved') : t('reading.form.pendingValidation'));
      form.reset({ readingDate: todayIso(), readingTime: '', notes: '' });
      setUpload(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.readings(meter.id) }),
        queryClient.invalidateQueries({ queryKey: ['meters'] }),
        queryClient.invalidateQueries({ queryKey: ['allocation-draft'] }),
      ]);
      onSaved?.(reading);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!buildingId) return null;
  const retained = Number.isFinite(value) ? normalizeReading(value, meter.normalization) : null;

  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <Tabs
        value={mode}
        onChange={setMode}
        items={[
          { value: 'photo', label: t('reading.form.modePhoto') },
          { value: 'manual', label: t('reading.form.modeManual') },
        ]}
      />

      {mode === 'photo' ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-500">{t('reading.form.photoHint')}</p>
          <PhotoUpload buildingId={buildingId} kind="METER_PHOTO" onUploaded={onUploaded} />
          {upload && detected?.value !== undefined ? (
            <Alert variant="warning" title={t('reading.form.detected', { value: formatIndex(detected.value) })}>
              <p>
                {detected.confidence !== undefined ? `${t('reading.form.confidence', { percent: formatPercent(detected.confidence, 0) })}. ` : ''}
                {detected.date ? `${t('reading.form.detectedDate', { date: formatDateFr(detected.date) })}. ` : ''}
                {t('reading.form.checkDetected')}
              </p>
              {detected.warnings?.map((w) => (
                <p key={w}>• {w}</p>
              ))}
            </Alert>
          ) : upload ? (
            <Alert variant="info">
              {upload.extractionError ?? t('reading.form.noDetection')}
              {detected?.warnings?.map((w) => (
                <p key={w}>• {w}</p>
              ))}
            </Alert>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('reading.form.value')}
          htmlFor="reading-value"
          error={form.formState.errors.value?.message}
          hint={
            <>
              {meter.normalization === 'INTEGER_TRUNCATE' ? t('reading.form.valueHint') : t('reading.form.valueHintAsIs')}
              {retained !== null && retained !== value ? (
                <span className="mt-1 block font-medium text-slate-700">{t('reading.form.retained', { value: formatIndex(retained) })}</span>
              ) : null}
            </>
          }
          className="sm:col-span-2"
        >
          <Input
            id="reading-value"
            type="number"
            inputMode="decimal"
            step="any"
            className="tabular text-lg"
            aria-invalid={Boolean(form.formState.errors.value)}
            {...form.register('value', { valueAsNumber: true })}
          />
        </Field>
        <Field label={t('reading.form.date')} htmlFor="reading-date" error={form.formState.errors.readingDate?.message}>
          <Input id="reading-date" type="date" aria-invalid={Boolean(form.formState.errors.readingDate)} {...form.register('readingDate')} />
        </Field>
        <Field label={t('reading.form.time')} htmlFor="reading-time" error={form.formState.errors.readingTime?.message} hint={t('reading.form.timeHint')}>
          <Input id="reading-time" type="time" step="1" {...form.register('readingTime')} />
        </Field>
        <Field label={`${t('reading.form.notes')} (${t('state.optional')})`} htmlFor="reading-notes" className="sm:col-span-2">
          <Textarea id="reading-notes" rows={2} {...form.register('notes')} />
        </Field>
      </div>

      {!can('reading.validate') ? <p className="text-xs text-slate-500">{t('reading.form.pendingValidation')}</p> : null}
      <Button type="submit" size="lg" loading={mutation.isPending} disabled={mode === 'photo' && !upload}>
        {t('reading.form.confirm')}
      </Button>
    </form>
  );
}
