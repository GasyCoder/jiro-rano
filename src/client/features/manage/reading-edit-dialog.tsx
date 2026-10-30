import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { ReadingDto } from '@shared/api';
import { dateString } from '@shared/schemas';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';

const Schema = z.object({
  value: z.number({ error: 'Index requis' }).finite().min(0, 'Index positif requis').max(1e9),
  readingDate: dateString,
  readingTime: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Heure invalide'),
  notes: z.string().max(1000),
  reason: z.string().trim().min(3, 'Indiquez la raison (3 caractères minimum)').max(500),
});
type Values = z.infer<typeof Schema>;

const withSeconds = (time: string) => (time.length === 5 ? `${time}:00` : time);

/**
 * Correction d'un relevé existant : seuls les champs modifiés sont envoyés, avec la raison
 * (enregistrée dans l'audit). Le serveur refuse si une répartition verrouillée l'utilise.
 */
export function ReadingEditDialog({ reading, onClose, onSaved }: { reading: ReadingDto | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const form = useForm<Values>({ resolver: zodResolver(Schema) });

  useEffect(() => {
    if (reading) {
      form.reset({
        value: reading.value,
        readingDate: reading.readingDate,
        readingTime: reading.readingTime ?? '',
        notes: reading.notes ?? '',
        reason: '',
      });
    }
  }, [reading, form]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<ReadingDto>(`/api/readings/${reading?.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success(t('readings.updated'));
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!reading) return;
    const body: Record<string, unknown> = { reason: values.reason };
    if (values.value !== reading.value) body.value = values.value;
    if (values.readingDate !== reading.readingDate) body.readingDate = values.readingDate;
    const time = values.readingTime ? withSeconds(values.readingTime) : null;
    if (time !== (reading.readingTime ?? null)) body.readingTime = time;
    const notes = values.notes.trim() || null;
    if (notes !== (reading.notes ?? null)) body.notes = notes;
    if (Object.keys(body).length === 1) {
      toast.error(t('readings.noChange'));
      return;
    }
    mutation.mutate(body);
  });

  const errors = form.formState.errors;
  return (
    <Dialog
      open={reading !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('readings.edit')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void onSubmit()} loading={mutation.isPending}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Alert variant="warning">{t('readings.editWarning')}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('reading.form.value')} htmlFor="edit-value" error={errors.value?.message} className="sm:col-span-2">
            <Input id="edit-value" type="number" inputMode="decimal" step="any" className="tabular" {...form.register('value', { valueAsNumber: true })} />
          </Field>
          <Field label={t('reading.form.date')} htmlFor="edit-date" error={errors.readingDate?.message}>
            <Input id="edit-date" type="date" {...form.register('readingDate')} />
          </Field>
          <Field label={t('reading.form.time')} htmlFor="edit-time" error={errors.readingTime?.message}>
            <Input id="edit-time" type="time" step="1" {...form.register('readingTime')} />
          </Field>
          <Field label={t('reading.form.notes')} htmlFor="edit-notes" className="sm:col-span-2">
            <Textarea id="edit-notes" rows={2} {...form.register('notes')} />
          </Field>
          <Field label={t('readings.reason')} htmlFor="edit-reason" error={errors.reason?.message} className="sm:col-span-2">
            <Textarea id="edit-reason" rows={2} {...form.register('reason')} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
