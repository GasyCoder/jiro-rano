import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { ConsumerDto, MeterDto } from '@shared/api';
import { METER_TYPES, READING_NORMALIZATIONS } from '@shared/domain';
import { METER_TYPE_LABELS } from '@shared/labels';
import { useCurrentBuilding } from '@/auth/building';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, Spinner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatDateFr, formatIndex } from '@/lib/format';
import { queryKeys } from '@/lib/query';

const MeterFormSchema = z.object({
  type: z.enum(METER_TYPES),
  label: z.string().trim().min(1, 'Champ obligatoire').max(80),
  serialNumber: z.string().max(80),
  unit: z.enum(['kWh', 'm3']),
  normalization: z.enum(READING_NORMALIZATIONS),
  rolloverAt: z.string().trim().regex(/^$|^\d+([.,]\d+)?$/, 'Nombre positif attendu'),
  active: z.boolean(),
  notes: z.string().max(1000),
});
type MeterFormValues = z.infer<typeof MeterFormSchema>;

const EMPTY: MeterFormValues = { type: 'SUB_METER', label: '', serialNumber: '', unit: 'kWh', normalization: 'INTEGER_TRUNCATE', rolloverAt: '', active: true, notes: '' };
const AFFECTED_KEYS = [['meters'], ['allocation-draft'], ['building']];

function MeterDialog({ open, meter, hasMain, onClose }: { open: boolean; meter: MeterDto | null; hasMain: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { buildingId } = useCurrentBuilding();
  const form = useForm<MeterFormValues>({ resolver: zodResolver(MeterFormSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    form.reset(
      meter
        ? {
            type: meter.type,
            label: meter.label,
            serialNumber: meter.serialNumber ?? '',
            unit: meter.unit,
            normalization: meter.normalization,
            rolloverAt: meter.rolloverAt != null ? String(meter.rolloverAt) : '',
            active: meter.active,
            notes: meter.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, meter, form]);

  const mutation = useMutation({
    mutationFn: ({ type, rolloverAt, ...values }: MeterFormValues) => {
      const body = { ...values, rolloverAt: rolloverAt ? Number(rolloverAt.replace(',', '.')) : null };
      return meter
        ? api<MeterDto>(`/api/meters/${meter.id}`, { method: 'PATCH', body })
        : api<MeterDto>(`/api/buildings/${buildingId}/meters`, { method: 'POST', body: { ...body, type } });
    },
    onSuccess: async () => {
      toast.success(t('building.meters.saved'));
      await Promise.all(AFFECTED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const types = METER_TYPES.filter((type) => meter || type !== 'MAIN' || !hasMain);
  const errors = form.formState.errors;
  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={meter ? t('building.meters.edit') : t('building.meters.add')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={mutation.isPending}>
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <Field label={t('building.meters.field.type')} htmlFor="m-type" hint={meter ? t('building.meters.field.typeLocked') : undefined}>
          {meter ? (
            // Pas de champ désactivé enregistré : react-hook-form lui donnerait la valeur undefined.
            <Input id="m-type" value={METER_TYPE_LABELS[meter.type]} readOnly className="bg-slate-50" />
          ) : (
            <Select id="m-type" {...form.register('type')}>
              {types.map((type) => (
                <option key={type} value={type}>
                  {METER_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('building.meters.field.label')} htmlFor="m-label" error={errors.label?.message}>
          <Input id="m-label" aria-invalid={Boolean(errors.label)} {...form.register('label')} />
        </Field>
        <Field label={t('building.meters.field.serial')} htmlFor="m-serial">
          <Input id="m-serial" {...form.register('serialNumber')} />
        </Field>
        <Field label={t('building.meters.field.unit')} htmlFor="m-unit">
          <Select id="m-unit" {...form.register('unit')}>
            <option value="kWh">kWh</option>
            <option value="m3">m³</option>
          </Select>
        </Field>
        <Field label={t('building.meters.field.normalization')} htmlFor="m-normalization">
          <Select id="m-normalization" {...form.register('normalization')}>
            {READING_NORMALIZATIONS.map((n) => (
              <option key={n} value={n}>
                {t(`building.meters.normalization.${n}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('building.meters.field.rollover')} htmlFor="m-rollover" error={errors.rolloverAt?.message} hint={t('building.meters.field.rolloverHint')}>
          <Input id="m-rollover" inputMode="decimal" {...form.register('rolloverAt')} />
        </Field>
        <Field label={t('building.meters.field.notes')} htmlFor="m-notes" className="sm:col-span-2">
          <Textarea id="m-notes" rows={2} {...form.register('notes')} />
        </Field>
        <Checkbox label={t('building.meters.field.active')} className="sm:col-span-2" {...form.register('active')} />
      </form>
    </Dialog>
  );
}

export function MetersTab() {
  const t = useT();
  const { buildingId, building, can } = useCurrentBuilding();
  const canManage = can('meter.manage');
  const [dialog, setDialog] = useState<{ open: boolean; meter: MeterDto | null }>({ open: false, meter: null });

  const metersQuery = useQuery({
    queryKey: queryKeys.meters(buildingId ?? 'none'),
    queryFn: () => api<MeterDto[]>(`/api/buildings/${buildingId}/meters`),
    enabled: Boolean(buildingId),
  });
  const consumersQuery = useQuery({
    queryKey: queryKeys.consumers(buildingId ?? 'none', true),
    queryFn: () => api<ConsumerDto[]>(`/api/buildings/${buildingId}/consumers?includeInactive=true`),
    enabled: Boolean(buildingId),
  });

  if (metersQuery.isLoading) return <Spinner />;
  if (metersQuery.isError) return <Alert variant="error">{errorMessage(metersQuery.error)}</Alert>;
  const meters = metersQuery.data ?? [];
  const hasMain = Boolean(building?.mainMeterId) || meters.some((m) => m.type === 'MAIN');

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div>
          <Button onClick={() => setDialog({ open: true, meter: null })}>
            <Plus /> {t('building.meters.add')}
          </Button>
        </div>
      ) : null}
      {meters.length === 0 ? (
        <EmptyState icon={<Gauge />} title={t('building.meters.empty')} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {meters.map((meter) => {
            const owner = consumersQuery.data?.find((c) => c.id === meter.consumerId);
            return (
              <li key={meter.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{meter.label}</span>
                    <Badge variant={meter.type === 'MAIN' ? 'validated' : 'neutral'}>{METER_TYPE_LABELS[meter.type]}</Badge>
                    {!meter.active ? <Badge variant="warning">{t('building.meters.inactive')}</Badge> : null}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t(`building.meters.normalization.${meter.normalization}`)}
                    {meter.rolloverAt != null ? ` · ${t('building.meters.rollover', { value: formatIndex(meter.rolloverAt) })}` : ''}
                    {meter.serialNumber ? ` · n° ${meter.serialNumber}` : ''}
                  </span>
                  {owner ? <span className="text-xs text-slate-600">{t('building.meters.assignedTo', { name: owner.name })}</span> : null}
                  <span className="tabular text-xs text-slate-600">
                    {meter.lastReading
                      ? t('readings.lastReading', { value: formatIndex(meter.lastReading.value), date: formatDateFr(meter.lastReading.readingDate) })
                      : t('readings.noReading')}
                  </span>
                </div>
                {canManage ? (
                  <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, meter })} aria-label={t('action.edit')} title={t('action.edit')}>
                    <Pencil />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <MeterDialog open={dialog.open} meter={dialog.meter} hasMain={hasMain} onClose={() => setDialog({ open: false, meter: null })} />
    </div>
  );
}
