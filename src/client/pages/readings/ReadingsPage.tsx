import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Gauge, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ConsumerDto, MeterDto, ReadingDto } from '@shared/api';
import { METER_TYPE_LABELS, READING_SOURCE_LABELS } from '@shared/labels';
import { useAuth } from '@/auth/auth';
import { useCurrentBuilding } from '@/auth/building';
import { ValidatedBadge } from '@/components/badges';
import { ReadingForm } from '@/components/reading-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ReadingEditDialog } from '@/features/manage/reading-edit-dialog';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatDateFr, formatDateTimeFr, formatIndex } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';

/** Un relevé modifié change potentiellement des factures, répartitions et le tableau de bord. */
const AFFECTED_KEYS = [['meters'], ['allocation-draft'], ['bills'], ['bill'], ['allocation'], ['allocations'], ['dashboard']];

export default function ReadingsPage() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { buildingId, building, can } = useCurrentBuilding();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ReadingDto | null>(null);
  const [photo, setPhoto] = useState<ReadingDto | null>(null);

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
  const meters = metersQuery.data ?? [];
  const selected = meters.find((m) => m.id === params.get('meter')) ?? meters.find((m) => m.type === 'SUB_METER') ?? meters[0] ?? null;
  const readingsQuery = useQuery({
    queryKey: queryKeys.readings(selected?.id ?? 'none'),
    queryFn: () => api<ReadingDto[]>(`/api/meters/${selected?.id}/readings?limit=200`),
    enabled: Boolean(selected),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.readings(selected?.id ?? 'none') }),
      ...AFFECTED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ]);
  };

  const validateMutation = useMutation({
    mutationFn: (id: string) => api<ReadingDto>(`/api/readings/${id}/validate`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success(t('readings.validated'));
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/api/readings/${id}`, { method: 'DELETE', body: { reason } }),
    onSuccess: async () => {
      toast.success(t('readings.deleted'));
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!buildingId) return <EmptyState icon={<Gauge />} title={t('nav.noBuilding')} />;

  const consumerName = (meter: MeterDto) => consumersQuery.data?.find((c) => c.id === meter.consumerId)?.name ?? null;
  const canEdit = (reading: ReadingDto) =>
    can('reading.validate') || (reading.createdBy === user?.id && !reading.validated && can('reading.create'));

  const onDelete = async (reading: ReadingDto) => {
    const result = await confirm({
      title: t('readings.delete'),
      description: t('readings.deleteDescription'),
      confirmLabel: t('action.delete'),
      destructive: true,
      requireReason: true,
    });
    if (result.confirmed) deleteMutation.mutate({ id: reading.id, reason: result.reason });
  };

  const actions = (reading: ReadingDto) => (
    <div className="flex flex-wrap justify-end gap-1">
      {!reading.validated && can('reading.validate') ? (
        <Button size="sm" variant="outline" onClick={() => validateMutation.mutate(reading.id)} loading={validateMutation.isPending && validateMutation.variables === reading.id}>
          <Check /> {t('readings.validate')}
        </Button>
      ) : null}
      {canEdit(reading) ? (
        <>
          <Button size="icon" variant="ghost" onClick={() => setEditing(reading)} aria-label={t('readings.edit')} title={t('readings.edit')}>
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void onDelete(reading)} aria-label={t('readings.delete')} title={t('readings.delete')}>
            <Trash2 />
          </Button>
        </>
      ) : null}
    </div>
  );

  const thumbnail = (reading: ReadingDto) =>
    reading.photoUrl ? (
      <button type="button" onClick={() => setPhoto(reading)} className="shrink-0 overflow-hidden rounded-md border border-slate-200" aria-label={t('readings.viewPhoto')}>
        <img src={reading.photoUrl} alt="" loading="lazy" className="size-12 object-cover" />
      </button>
    ) : null;

  const readings = readingsQuery.data ?? [];

  return (
    <>
      <PageHeader
        title={t('readings.title')}
        description={building?.name ? `${building.name} · ${t('readings.description')}` : t('readings.description')}
        actions={
          selected && can('reading.create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> {t('readings.new')}
            </Button>
          ) : null
        }
      />

      {metersQuery.isLoading ? (
        <Spinner />
      ) : metersQuery.isError ? (
        <Alert variant="error">{errorMessage(metersQuery.error)}</Alert>
      ) : meters.length === 0 ? (
        <EmptyState icon={<Gauge />} title={t('readings.noMeters')} description={t('readings.noMetersHint')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label={t('readings.meters')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {meters.map((meter) => {
              const active = meter.id === selected?.id;
              const owner = consumerName(meter);
              return (
                <button
                  key={meter.id}
                  type="button"
                  onClick={() => setParams({ meter: meter.id }, { replace: true })}
                  aria-current={active}
                  className={cn(
                    'flex min-w-56 flex-col gap-1 rounded-xl border p-3 text-left transition-colors lg:min-w-0',
                    active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{meter.label}</span>
                    {!meter.active ? <Badge>{t('building.meters.inactive')}</Badge> : null}
                  </span>
                  <span className="text-xs text-slate-500">
                    {METER_TYPE_LABELS[meter.type]}
                    {owner ? ` · ${owner}` : ''}
                  </span>
                  <span className="tabular text-xs text-slate-600">
                    {meter.lastReading
                      ? t('readings.lastReading', { value: formatIndex(meter.lastReading.value), date: formatDateFr(meter.lastReading.readingDate) })
                      : t('readings.noReading')}
                  </span>
                </button>
              );
            })}
          </nav>

          {selected ? (
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>
                    {t('readings.history')} · {selected.label}
                  </CardTitle>
                  <p className="text-sm text-slate-500">
                    {consumerName(selected) ? t('readings.consumer', { name: consumerName(selected) ?? '' }) : t('readings.unassigned')}
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                {readingsQuery.isLoading ? (
                  <Spinner />
                ) : readings.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">{t('readings.empty')}</p>
                ) : (
                  <>
                    <ul className="flex flex-col divide-y divide-slate-100 md:hidden">
                      {readings.map((reading) => (
                        <li key={reading.id} className="flex gap-3 py-3">
                          {thumbnail(reading)}
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="tabular text-lg font-semibold text-slate-900">{formatIndex(reading.value)}</span>
                              <ValidatedBadge validated={reading.validated} />
                            </div>
                            <p className="text-xs text-slate-600">
                              {formatDateTimeFr(reading.readingDate, reading.readingTime)} · {READING_SOURCE_LABELS[reading.source]}
                              {reading.normalizedValue !== reading.value ? ` · ${t('readings.retained', { value: formatIndex(reading.normalizedValue) })}` : ''}
                            </p>
                            {reading.notes ? <p className="text-xs text-slate-500">{reading.notes}</p> : null}
                            {actions(reading)}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden md:block">
                      <Table>
                        <THead>
                          <TR>
                            <TH>{t('readings.col.date')}</TH>
                            <TH className="text-right">{t('readings.col.value')}</TH>
                            <TH className="text-right">{t('readings.col.retained')}</TH>
                            <TH>{t('readings.col.source')}</TH>
                            <TH>{t('readings.col.status')}</TH>
                            <TH>{t('readings.col.photo')}</TH>
                            <TH className="text-right">{t('readings.col.actions')}</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {readings.map((reading) => (
                            <TR key={reading.id}>
                              <TD className="whitespace-nowrap">
                                {formatDateTimeFr(reading.readingDate, reading.readingTime)}
                                {reading.notes ? <p className="max-w-56 text-xs text-slate-500">{reading.notes}</p> : null}
                              </TD>
                              <TD className="tabular text-right">{formatIndex(reading.value)}</TD>
                              <TD className="tabular text-right font-medium">{formatIndex(reading.normalizedValue)}</TD>
                              <TD>{READING_SOURCE_LABELS[reading.source]}</TD>
                              <TD>
                                <ValidatedBadge validated={reading.validated} />
                              </TD>
                              <TD>{thumbnail(reading) ?? <Camera className="size-4 text-slate-300" aria-hidden />}</TD>
                              <TD>{actions(reading)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {selected ? (
        <Sheet open={creating} onOpenChange={setCreating} title={t('readings.new')} description={selected.label}>
          <ReadingForm meter={selected} onSaved={() => setCreating(false)} />
        </Sheet>
      ) : null}

      <ReadingEditDialog reading={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />

      <Dialog
        open={photo !== null}
        onOpenChange={(open) => !open && setPhoto(null)}
        title={photo ? t('readings.photoTitle', { date: formatDateTimeFr(photo.readingDate, photo.readingTime) }) : ''}
        description={photo ? `${t('readings.col.value')} : ${formatIndex(photo.value)}` : undefined}
        className="sm:max-w-3xl"
      >
        {photo?.photoUrl ? <img src={photo.photoUrl} alt={t('readings.viewPhoto')} className="mx-auto max-h-[70dvh] w-full object-contain" /> : null}
      </Dialog>
    </>
  );
}
