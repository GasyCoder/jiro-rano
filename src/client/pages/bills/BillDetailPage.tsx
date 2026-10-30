import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, FlaskConical, Lock, Pencil, Printer, RefreshCw, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AllocationDetailDto, AllocationDraftDto, AllocationSummaryDto, BillDto, FileDto } from '@shared/api';
import type { AllocationConfig } from '@shared/schemas';
import { useCurrentBuilding } from '@/auth/building';
import { AllocationStatusBadge, CalculationStatusBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { BillConsistencyAlerts, BillForm, type BillPayload, billToFormValues } from '@/features/allocation/BillForm';
import { CalculationDetailsButton } from '@/features/allocation/CalculationDetails';
import { useAllocation, useAllocationDraft, useAllocationVersions, useBill, useInvalidateBill, useSimulation } from '@/features/allocation/hooks';
import { IssuesList } from '@/features/allocation/Issues';
import { ResultTable } from '@/features/allocation/ResultTable';
import { rowsFromItems } from '@/features/allocation/rows';
import { SimulationPanel } from '@/features/allocation/SimulationPanel';
import { WhatsAppShare } from '@/features/allocation/WhatsAppShare';
import { useAllocationWorkflow } from '@/features/allocation/workflow';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatAriary, formatBillMonth, formatDateFr, formatIndex, formatKwh, formatNumber, formatPeriod, formatTimestamp } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function BillInfo({ bill }: { bill: BillDto }) {
  const t = useT();
  const meter =
    bill.mainMeterPreviousIndex !== null && bill.mainMeterCurrentIndex !== null
      ? `${formatIndex(bill.mainMeterPreviousIndex)} → ${formatIndex(bill.mainMeterCurrentIndex)}`
      : '—';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bills.detail.summary')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <InfoItem label={t('bills.detail.period')} value={`${formatPeriod(bill.periodStart, bill.periodEnd)} · ${t('bills.detail.days', { days: bill.days })}`} />
          <InfoItem label={t('bills.detail.mainMeter')} value={meter} />
          <InfoItem label={t('bills.detail.kwh')} value={`${formatKwh(bill.electricityKwh)} kWh`} />
          <InfoItem label={t('bills.detail.electricity')} value={formatAriary(bill.electricityAmount)} />
          <InfoItem label={t('bills.detail.water')} value={formatAriary(bill.waterAmount)} />
          <InfoItem label={t('bills.detail.total')} value={formatAriary(bill.totalAmount)} />
        </dl>
        {bill.invoiceNumber || bill.dueDate ? (
          <p className="text-sm text-slate-600">
            {bill.invoiceNumber ? t('bills.detail.invoice', { number: bill.invoiceNumber }) : null}
            {bill.invoiceNumber && bill.dueDate ? ' · ' : null}
            {bill.dueDate ? t('bills.detail.dueDate', { date: formatDateFr(bill.dueDate) }) : null}
          </p>
        ) : null}
        {bill.notes ? <p className="rounded-md bg-slate-50 p-3 text-sm whitespace-pre-line text-slate-700">{bill.notes}</p> : null}
      </CardContent>
    </Card>
  );
}

function Documents({ documents }: { documents: FileDto[] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bills.detail.documents')}</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">{t('bills.detail.noDocuments')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {documents.map((doc) => (
              <li key={doc.id}>
                <a href={doc.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 hover:border-brand-300">
                  {doc.mimeType.startsWith('image/') && doc.mimeType !== 'image/heic' ? (
                    <img src={doc.url} alt={doc.originalName ?? ''} className="h-32 w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-32 flex-col items-center justify-center gap-2 p-2 text-center text-xs text-slate-600">
                      <FileText className="size-6" /> {doc.originalName ?? doc.mimeType}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function VersionList({ versions, selectedId, onSelect }: { versions: AllocationSummaryDto[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-2">
      {versions.map((version) => (
        <li key={version.id}>
          <button
            type="button"
            onClick={() => onSelect(version.id)}
            className={cn(
              'flex w-full flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-colors',
              version.id === selectedId ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50',
            )}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t('allocation.version', { version: version.version })}</span>
              <AllocationStatusBadge status={version.status} />
              {version.totalPayable !== null ? <span className="tabular text-slate-600">{formatAriary(version.totalPayable, 0)}</span> : null}
            </span>
            <span className="text-xs text-slate-500">
              {t('allocation.createdBy', { date: formatTimestamp(version.createdAt), name: version.createdByName ?? '—' })}
              {version.validatedAt ? ` · ${t('allocation.validatedOn', { date: formatTimestamp(version.validatedAt) })}` : ''}
            </span>
            {version.correctionReason ? <span className="text-xs text-slate-600">{t('allocation.correction', { reason: version.correctionReason })}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Panneau « Simuler la répartition » : part du brouillon serveur, rien n'est enregistré sans clic explicite. */
function SimulationSheet({ bill, open, onOpenChange, onSaved }: { bill: BillDto; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (allocation: AllocationDetailDto) => void }) {
  const t = useT();
  const draftQuery = useAllocationDraft(bill.id, open);
  const [config, setConfig] = useState<AllocationConfig | null>(null);
  const effective = config ?? draftQuery.data?.config ?? null;
  const simulationQuery = useSimulation(bill.id, open ? effective : null, 400);
  const workflow = useAllocationWorkflow(bill);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfig(null);
        onOpenChange(next);
      }}
      title={t('allocation.simulation.title')}
      description={t('allocation.simulation.description')}
      footer={
        <Button
          disabled={!effective || !simulationQuery.data?.ok}
          loading={workflow.isPending}
          onClick={async () => {
            if (!effective) return;
            const created = await workflow.save(effective);
            if (created) {
              setConfig(null);
              onSaved(created);
            }
          }}
        >
          {t('allocation.simulation.save')}
        </Button>
      }
    >
      {draftQuery.isLoading || !draftQuery.data || !effective ? (
        draftQuery.error ? <Alert variant="error">{errorMessage(draftQuery.error)}</Alert> : <Spinner />
      ) : (
        <SimulationPanel
          draft={draftQuery.data}
          config={effective}
          onChange={setConfig}
          simulation={simulationQuery.data}
          isFetching={simulationQuery.isFetching}
          error={simulationQuery.error}
        />
      )}
    </Sheet>
  );
}

function AllocationCard({ bill, allocation, buildingName }: { bill: BillDto; allocation: AllocationDetailDto; buildingName: string }) {
  const t = useT();
  const { can } = useCurrentBuilding();
  const workflow = useAllocationWorkflow(bill);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const names = new Map(allocation.items.map((i) => [i.consumerId, i.consumerName]));
  const shareable = allocation.status !== 'DRAFT' && allocation.items.length > 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t('bills.detail.allocation')} {t('allocation.version', { version: allocation.version })}
            <AllocationStatusBadge status={allocation.status} />
          </CardTitle>
          <p className="text-xs text-slate-500">
            {t('allocation.createdBy', { date: formatTimestamp(allocation.createdAt), name: allocation.createdByName ?? '—' })}
            {allocation.validatedAt ? ` · ${t('allocation.validatedOn', { date: formatTimestamp(allocation.validatedAt) })}` : ''}
          </p>
          {allocation.correctionReason ? <p className="text-xs text-slate-600">{t('allocation.correction', { reason: allocation.correctionReason })}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {allocation.items.length > 0 ? <ResultTable rows={rowsFromItems(allocation.items)} showMethod /> : null}
        {allocation.effectivePricePerKwh !== null ? (
          <p className="text-xs text-slate-500">
            {t('allocation.effectivePrice', { price: formatNumber(allocation.effectivePricePerKwh, 2) })} {t('allocation.payableNote')}
          </p>
        ) : null}
        <IssuesList errors={allocation.errors} warnings={allocation.warnings} />
        <div className="flex flex-wrap gap-2">
          <CalculationDetailsButton steps={allocation.steps} names={names} />
          {allocation.status === 'CALCULATED' && can('allocation.validate') ? (
            <Button loading={workflow.isPending} onClick={() => void workflow.validate(allocation.id)}>
              <ShieldCheck /> {t('allocation.action.validate')}
            </Button>
          ) : null}
          {allocation.status === 'VALIDATED' && can('allocation.lock') ? (
            <Button variant="outline" loading={workflow.isPending} onClick={() => void workflow.lock(allocation.id)}>
              <Lock /> {t('allocation.action.lock')}
            </Button>
          ) : null}
          {shareable ? (
            <>
              <Button variant="outline" onClick={() => setWhatsAppOpen(true)}>
                {t('whatsapp.copy')}
              </Button>
              <Button asChild variant="outline">
                <Link to={`/report/${allocation.id}`}>
                  <Printer /> {t('allocation.action.report')}
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
      <Dialog open={whatsAppOpen} onOpenChange={setWhatsAppOpen} title={t('whatsapp.title')}>
        <WhatsAppShare allocation={allocation} bill={bill} buildingName={buildingName} />
      </Dialog>
    </Card>
  );
}

export default function BillDetailPage() {
  const t = useT();
  const { billId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBill();
  const { can, building, membership } = useCurrentBuilding();
  const billQuery = useBill(billId);
  const bill = billQuery.data;
  const versionsQuery = useAllocationVersions(billId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shownId = selectedId ?? bill?.currentAllocation?.id ?? null;
  const allocationQuery = useAllocation(shownId);
  const workflow = useAllocationWorkflow(bill);
  const [editOpen, setEditOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  const update = useMutation({
    mutationFn: (body: BillPayload & { reason?: string }) => api<BillDto>(`/api/bills/${billId}`, { method: 'PATCH', body }),
    onSuccess: async (updated) => {
      toast.success(t('bills.detail.updated'));
      setEditOpen(false);
      await invalidate(updated.id, updated.buildingId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (reason: string) => api(`/api/bills/${billId}`, { method: 'DELETE', body: { reason } }),
    onSuccess: async () => {
      toast.success(t('bills.detail.deleted'));
      await invalidate(billId, bill?.buildingId);
      navigate('/bills', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (billQuery.isLoading) return <Spinner />;
  if (billQuery.isError || !bill) {
    return <EmptyState title={t('state.error')} description={billQuery.error ? errorMessage(billQuery.error) : undefined} />;
  }

  const allocated = bill.calculationStatus !== 'NOT_CALCULATED';
  const buildingName = building?.name ?? membership?.buildingName ?? '';

  const onEdit = async (payload: BillPayload) => {
    if (allocated) {
      const answer = await confirm({ title: t('bills.detail.edit'), description: t('bills.detail.editReason'), requireReason: true });
      if (!answer.confirmed) return;
      await update.mutateAsync({ ...payload, reason: answer.reason }).catch(() => undefined);
      return;
    }
    await update.mutateAsync(payload).catch(() => undefined);
  };

  const onDelete = async () => {
    const answer = await confirm({
      title: t('bills.detail.deleteConfirm'),
      description: t('bills.detail.deleteDescription'),
      requireReason: true,
      destructive: true,
      confirmLabel: t('action.delete'),
    });
    if (answer.confirmed) remove.mutate(answer.reason);
  };

  const onRecalculate = async () => {
    try {
      const draft = await queryClient.fetchQuery({
        queryKey: queryKeys.allocationDraft(bill.id),
        queryFn: () => api<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`),
        staleTime: 0,
      });
      const created = await workflow.save(draft.config, { askConfirm: true });
      if (created) setSelectedId(created.id);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title={<span className="capitalize">{formatBillMonth(bill.periodEnd)}</span>}
        description={formatPeriod(bill.periodStart, bill.periodEnd)}
        back={
          <Link to="/bills" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {t('bills.detail.back')}
          </Link>
        }
        actions={
          <>
            <CalculationStatusBadge status={bill.calculationStatus} />
            {can('bill.write') ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil /> {t('action.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void onDelete()} loading={remove.isPending}>
                  <Trash2 /> {t('action.delete')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <BillConsistencyAlerts values={billToFormValues(bill)} />
        {bill.calculationStatus === 'OUTDATED' ? <Alert variant="warning">{t('bills.warning.outdated')}</Alert> : null}

        {can('allocation.calculate') ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSimulateOpen(true)}>
              <FlaskConical /> {t('allocation.action.simulate')}
            </Button>
            <Button variant="outline" onClick={() => void onRecalculate()} loading={workflow.isPending}>
              <RefreshCw /> {t('allocation.action.recalculate')}
            </Button>
            <Button asChild variant="ghost">
              <Link to={`/bills/new?billId=${bill.id}&step=2`}>
                <Wand2 /> {t('bills.detail.wizard')}
              </Link>
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4">
          <div className="flex flex-col gap-4">
            {shownId ? (
              allocationQuery.isLoading ? (
                <Spinner />
              ) : allocationQuery.data ? (
                <>
                  {selectedId && selectedId !== bill.currentAllocation?.id ? (
                    <Alert variant="info">
                      {t('bills.detail.viewing', { version: allocationQuery.data.version })}{' '}
                      <button type="button" className="font-medium underline" onClick={() => setSelectedId(null)}>
                        {t('bills.detail.showCurrent')}
                      </button>
                    </Alert>
                  ) : null}
                  <AllocationCard bill={bill} allocation={allocationQuery.data} buildingName={buildingName} />
                </>
              ) : (
                <Alert variant="error">{errorMessage(allocationQuery.error)}</Alert>
              )
            ) : (
              <EmptyState title={t('bills.detail.noAllocation')} />
            )}
            <BillInfo bill={bill} />
          </div>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('bills.detail.versions')}</CardTitle>
              </CardHeader>
              <CardContent>
                {versionsQuery.data && versionsQuery.data.length > 0 ? (
                  <VersionList versions={versionsQuery.data} selectedId={shownId} onSelect={setSelectedId} />
                ) : (
                  <p className="text-sm text-slate-500">{t('bills.detail.noAllocation')}</p>
                )}
              </CardContent>
            </Card>
            <Documents documents={bill.documents} />
          </div>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title={t('bills.detail.edit')} description={allocated ? t('bills.detail.editReason') : undefined} className="sm:max-w-2xl">
        <BillForm defaultValues={billToFormValues(bill)} submitLabel={t('action.save')} busy={update.isPending} onSubmit={onEdit} />
      </Dialog>

      {can('allocation.calculate') ? (
        <SimulationSheet
          bill={bill}
          open={simulateOpen}
          onOpenChange={setSimulateOpen}
          onSaved={(created) => {
            setSimulateOpen(false);
            setSelectedId(created.id);
          }}
        />
      ) : null}
    </>
  );
}
