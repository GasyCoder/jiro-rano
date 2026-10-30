import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { ConsumerDto, MeterDto } from '@shared/api';
import { ALLOCATION_MODES, CONSUMER_TYPES } from '@shared/domain';
import { ALLOCATION_MODE_LABELS, CONSUMER_TYPE_LABELS } from '@shared/labels';
import { useCurrentBuilding } from '@/auth/building';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, Spinner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { queryKeys } from '@/lib/query';

const ConsumerFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Champ obligatoire').max(80),
    description: z.string().max(500),
    type: z.enum(CONSUMER_TYPES),
    allocationMode: z.enum(ALLOCATION_MODES),
    meterId: z.string(),
    weight: z.number({ error: 'Nombre requis' }).positive('Coefficient strictement positif').max(1000),
    waterWeight: z.number({ error: 'Nombre requis' }).min(0).max(1000),
    active: z.boolean(),
  })
  .refine((v) => v.allocationMode !== 'SUB_METER' || v.meterId !== '', {
    path: ['meterId'],
    message: 'Choisissez le sous-compteur de ce consommateur',
  });
type ConsumerFormValues = z.infer<typeof ConsumerFormSchema>;

const EMPTY: ConsumerFormValues = { name: '', description: '', type: 'FLOOR', allocationMode: 'DIFFERENCE', meterId: '', weight: 1, waterWeight: 1, active: true };

/** Clés à rafraîchir quand la liste ou la configuration des consommateurs change. */
const AFFECTED_KEYS = [['consumers'], ['meters'], ['allocation-draft'], ['dashboard']];

function ConsumerDialog({
  open,
  consumer,
  meters,
  onClose,
}: {
  open: boolean;
  consumer: ConsumerDto | null;
  meters: MeterDto[];
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { buildingId } = useCurrentBuilding();
  const form = useForm<ConsumerFormValues>({ resolver: zodResolver(ConsumerFormSchema), defaultValues: EMPTY });
  const mode = form.watch('allocationMode');

  useEffect(() => {
    if (!open) return;
    form.reset(
      consumer
        ? {
            name: consumer.name,
            description: consumer.description ?? '',
            type: consumer.type,
            allocationMode: consumer.allocationMode,
            meterId: consumer.meterId ?? '',
            weight: consumer.weight,
            waterWeight: consumer.waterWeight,
            active: consumer.active,
          }
        : EMPTY,
    );
  }, [open, consumer, form]);

  const mutation = useMutation({
    mutationFn: (values: ConsumerFormValues) => {
      const body = { ...values, meterId: values.meterId || null };
      return consumer
        ? api<ConsumerDto>(`/api/consumers/${consumer.id}`, { method: 'PATCH', body })
        : api<ConsumerDto>(`/api/buildings/${buildingId}/consumers`, { method: 'POST', body });
    },
    onSuccess: async () => {
      toast.success(t('building.consumers.saved'));
      await Promise.all(AFFECTED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const availableMeters = meters.filter((m) => (m.type === 'SUB_METER' || m.type === 'COMMON') && (!m.consumerId || m.consumerId === consumer?.id));
  const errors = form.formState.errors;
  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={consumer ? t('building.consumers.edit') : t('building.consumers.add')}
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
        <Field label={t('building.consumers.field.name')} htmlFor="c-name" error={errors.name?.message}>
          <Input id="c-name" aria-invalid={Boolean(errors.name)} {...form.register('name')} />
        </Field>
        <Field label={t('building.consumers.field.type')} htmlFor="c-type">
          <Select id="c-type" {...form.register('type')}>
            {CONSUMER_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONSUMER_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('building.consumers.field.description')} htmlFor="c-description" className="sm:col-span-2">
          <Textarea id="c-description" rows={2} {...form.register('description')} />
        </Field>
        <Field label={t('building.consumers.field.method')} htmlFor="c-mode">
          <Select id="c-mode" {...form.register('allocationMode')}>
            {ALLOCATION_MODES.map((m) => (
              <option key={m} value={m}>
                {ALLOCATION_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('building.consumers.field.meter')} htmlFor="c-meter" error={errors.meterId?.message}>
          <Select id="c-meter" aria-invalid={Boolean(errors.meterId)} {...form.register('meterId')}>
            <option value="">{t('building.consumers.field.noMeter')}</option>
            {availableMeters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {mode === 'WEIGHTED_SHARE' ? (
          <Field label={t('building.consumers.field.weight')} htmlFor="c-weight" error={errors.weight?.message} hint={t('building.consumers.field.weightHint')}>
            <Input id="c-weight" type="number" inputMode="decimal" step="any" {...form.register('weight', { valueAsNumber: true })} />
          </Field>
        ) : null}
        <Field
          label={t('building.consumers.field.waterWeight')}
          htmlFor="c-water"
          error={errors.waterWeight?.message}
          hint={t('building.consumers.field.waterWeightHint')}
        >
          <Input id="c-water" type="number" inputMode="decimal" step="any" min={0} {...form.register('waterWeight', { valueAsNumber: true })} />
        </Field>
        {consumer ? <Checkbox label={t('building.consumers.field.active')} className="sm:col-span-2" {...form.register('active')} /> : null}
      </form>
    </Dialog>
  );
}

export function ConsumersTab() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { buildingId, can } = useCurrentBuilding();
  const canManage = can('consumer.manage');
  const [dialog, setDialog] = useState<{ open: boolean; consumer: ConsumerDto | null }>({ open: false, consumer: null });

  const consumersQuery = useQuery({
    queryKey: queryKeys.consumers(buildingId ?? 'none', true),
    queryFn: () => api<ConsumerDto[]>(`/api/buildings/${buildingId}/consumers?includeInactive=true`),
    enabled: Boolean(buildingId),
  });
  const metersQuery = useQuery({
    queryKey: queryKeys.meters(buildingId ?? 'none'),
    queryFn: () => api<MeterDto[]>(`/api/buildings/${buildingId}/meters`),
    enabled: Boolean(buildingId),
  });

  const invalidate = () => Promise.all(AFFECTED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const consumers = [...(consumersQuery.data ?? [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const meters = metersQuery.data ?? [];

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`/api/buildings/${buildingId}/consumers/reorder`, { method: 'POST', body: { ids } }),
    onSuccess: async () => {
      toast.success(t('building.consumers.reordered'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api(`/api/consumers/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: async (_data, { active }) => {
      toast.success(active ? t('building.consumers.reactivated') : t('building.consumers.deactivated'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/consumers/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success(t('building.consumers.deleted'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const move = (index: number, direction: -1 | 1) => {
    const ids = consumers.map((c) => c.id);
    const target = index + direction;
    const current = ids[index];
    const other = ids[target];
    if (current === undefined || other === undefined) return;
    ids[index] = other;
    ids[target] = current;
    reorder.mutate(ids);
  };

  const onDelete = async (consumer: ConsumerDto) => {
    if (consumer.hasHistory) {
      const result = await confirm({
        title: t('building.consumers.deactivateTitle', { name: consumer.name }),
        description: t('building.consumers.deactivateDescription', { name: consumer.name }),
        confirmLabel: t('building.consumers.deactivate'),
      });
      if (result.confirmed) update.mutate({ id: consumer.id, active: false });
      return;
    }
    const result = await confirm({
      title: t('building.consumers.deleteTitle', { name: consumer.name }),
      description: t('building.consumers.deleteDescription', { name: consumer.name }),
      confirmLabel: t('action.delete'),
      destructive: true,
    });
    if (result.confirmed) remove.mutate(consumer.id);
  };

  if (consumersQuery.isLoading) return <Spinner />;
  if (consumersQuery.isError) return <Alert variant="error">{errorMessage(consumersQuery.error)}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">{t('building.consumers.help')}</Alert>
      {canManage ? (
        <div>
          <Button onClick={() => setDialog({ open: true, consumer: null })}>
            <Plus /> {t('building.consumers.add')}
          </Button>
        </div>
      ) : null}
      {consumers.length === 0 ? (
        <EmptyState icon={<Users />} title={t('building.consumers.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {consumers.map((consumer, index) => {
            const meter = meters.find((m) => m.id === consumer.meterId);
            return (
              <li key={consumer.id} className="flex flex-wrap items-center gap-3 p-3">
                {canManage ? (
                  <div className="flex flex-col">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-8"
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => move(index, -1)}
                      aria-label={t('building.consumers.moveUp')}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-8"
                      disabled={index === consumers.length - 1 || reorder.isPending}
                      onClick={() => move(index, 1)}
                      aria-label={t('building.consumers.moveDown')}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{consumer.name}</span>
                    {!consumer.active ? <Badge variant="warning">{t('building.consumers.inactive')}</Badge> : null}
                  </span>
                  <span className="text-xs text-slate-500">
                    {CONSUMER_TYPE_LABELS[consumer.type]} · {ALLOCATION_MODE_LABELS[consumer.allocationMode]}
                    {meter ? ` · ${meter.label}` : ''}
                    {consumer.allocationMode === 'WEIGHTED_SHARE' ? ` · ${t('building.consumers.weight', { weight: formatNumber(consumer.weight, 2) })}` : ''}
                  </span>
                  {consumer.description ? <span className="text-xs text-slate-500">{consumer.description}</span> : null}
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, consumer })} aria-label={t('action.edit')} title={t('action.edit')}>
                      <Pencil />
                    </Button>
                    {consumer.active ? (
                      <Button size="icon" variant="ghost" onClick={() => void onDelete(consumer)} aria-label={t('action.delete')} title={t('action.delete')}>
                        <Trash2 />
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => update.mutate({ id: consumer.id, active: true })}>
                        <RotateCcw /> {t('building.consumers.reactivate')}
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ConsumerDialog open={dialog.open} consumer={dialog.consumer} meters={meters} onClose={() => setDialog({ open: false, consumer: null })} />
    </div>
  );
}
