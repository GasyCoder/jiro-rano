import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileText, Plus, Printer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AllocationDraftConsumerDto, AllocationDraftDto, BillDto, ReadingDto } from '@shared/api';
import type { AllocationConfig } from '@shared/schemas';
import { useCurrentBuilding } from '@/auth/building';
import { AllocationStatusBadge, ValidatedBadge } from '@/components/badges';
import { ReadingForm } from '@/components/reading-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet } from '@/components/ui/dialog';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { BillExtraction } from '@/features/allocation/BillExtraction';
import { BillForm, type BillFormValues, type BillPayload } from '@/features/allocation/BillForm';
import { useAllocation, useAllocationDraft, useBill, useInvalidateBill, useSimulation } from '@/features/allocation/hooks';
import { ResultTable } from '@/features/allocation/ResultTable';
import { readingLabel, rowsFromItems } from '@/features/allocation/rows';
import { SimulationPanel, SimulationResult } from '@/features/allocation/SimulationPanel';
import { Stepper, WIZARD_STEPS, type WizardStep } from '@/features/allocation/Stepper';
import { WhatsAppShare } from '@/features/allocation/WhatsAppShare';
import { useAllocationWorkflow } from '@/features/allocation/workflow';
import { useT } from '@/i18n';
import { api, errorMessage } from '@/lib/api';
import { formatAriary, formatKwh, formatPeriod } from '@/lib/format';

function StepCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
      {footer ? <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">{footer}</div> : null}
    </Card>
  );
}

function NavButtons({ onBack, next }: { onBack?: () => void; next?: ReactNode }) {
  const t = useT();
  return (
    <>
      {onBack ? (
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft /> {t('action.previous')}
        </Button>
      ) : (
        <span />
      )}
      {next}
    </>
  );
}

function BillSummary({ bill }: { bill: BillDto }) {
  const t = useT();
  return (
    <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-slate-500">{t('bills.detail.period')}</dt>
        <dd className="font-medium">{formatPeriod(bill.periodStart, bill.periodEnd)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">{t('bills.detail.kwh')}</dt>
        <dd className="font-medium">{formatKwh(bill.electricityKwh)} kWh</dd>
      </div>
      <div>
        <dt className="text-slate-500">{t('bills.detail.electricity')}</dt>
        <dd className="font-medium">{formatAriary(bill.electricityAmount)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">{t('bills.detail.total')}</dt>
        <dd className="font-medium">{formatAriary(bill.totalAmount)}</dd>
      </div>
    </dl>
  );
}

// --- Étape 1 : facture -------------------------------------------------------

function StepBill({ buildingId, bill, onCreated, onNext }: { buildingId: string; bill: BillDto | undefined; onCreated: (id: string) => void; onNext: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateBill();
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [prefill, setPrefill] = useState<Partial<BillFormValues> | null>(null);
  const create = useMutation({
    mutationFn: (payload: BillPayload) =>
      api<BillDto>(`/api/buildings/${buildingId}/bills`, { method: 'POST', body: { ...payload, ...(fileIds.length ? { documentFileIds: fileIds } : {}) } }),
    onSuccess: async (created) => {
      toast.success(t('bills.wizard.step1.created'));
      await invalidate(created.id, buildingId);
      onCreated(created.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (bill) {
    return (
      <StepCard
        title={t('bills.wizard.step.1')}
        footer={
          <NavButtons
            next={
              <Button onClick={onNext}>
                {t('action.next')} <ArrowRight />
              </Button>
            }
          />
        }
      >
        <Alert variant="success">{t('bills.wizard.step1.existing')}</Alert>
        <BillSummary bill={bill} />
      </StepCard>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
      <StepCard title={t('bills.photo.title')}>
        <BillExtraction buildingId={buildingId} onUploaded={(id) => setFileIds((ids) => [...ids, id])} onApply={(values) => setPrefill({ ...values })} />
      </StepCard>
      <StepCard title={t('bills.wizard.step.1')} description={t('bills.wizard.step1.description')}>
        <BillForm prefill={prefill} submitLabel={t('bills.wizard.step1.create')} busy={create.isPending} onSubmit={(payload) => create.mutateAsync(payload).then(() => undefined, () => undefined)} />
      </StepCard>
    </div>
  );
}

// --- Étape 2 : relevés -------------------------------------------------------

function ReadingLine({ label, reading }: { label: string; reading: ReadingDto | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-slate-50 px-3 py-2 text-sm">
      <span className="text-xs text-slate-500">{label}</span>
      {reading ? (
        <span className="tabular flex flex-wrap items-center gap-2 font-medium text-slate-900">
          {readingLabel(reading)} <ValidatedBadge validated={reading.validated} />
        </span>
      ) : (
        <span className="text-slate-400">—</span>
      )}
    </div>
  );
}

function ConsumerReadings({ entry, canAdd, onAdd }: { entry: AllocationDraftConsumerDto; canAdd: boolean; onAdd: () => void }) {
  const t = useT();
  const { consumer, meter, readings, suggestedStartId, suggestedEndId } = entry;
  const isSubMeter = consumer.allocationMode === 'SUB_METER';
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-900">{consumer.name}</p>
        <Badge>{t(`allocation.mode.${consumer.allocationMode}`)}</Badge>
      </div>
      {isSubMeter && meter ? (
        <>
          <p className="text-xs text-slate-500">{t('allocation.editor.meter', { meter: meter.label })}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ReadingLine label={t('bills.wizard.step2.oldIndex')} reading={readings.find((r) => r.id === suggestedStartId)} />
            <ReadingLine label={t('bills.wizard.step2.newIndex')} reading={readings.find((r) => r.id === suggestedEndId)} />
          </div>
          {!suggestedStartId || !suggestedEndId ? <Alert variant="warning">{t('bills.wizard.step2.missing')}</Alert> : null}
          {readings.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">{t('bills.wizard.step2.allReadings', { count: readings.length })}</summary>
              <ul className="tabular mt-2 flex flex-col gap-1">
                {readings.map((reading) => (
                  <li key={reading.id} className="flex flex-wrap items-center gap-2">
                    {readingLabel(reading)} <ValidatedBadge validated={reading.validated} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {canAdd ? (
            <div>
              <Button variant="outline" size="sm" onClick={onAdd}>
                <Plus /> {t('bills.wizard.step2.addReading')}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-500">{t('bills.wizard.step2.noSubMeter', { method: t(`allocation.mode.${consumer.allocationMode}`) })}</p>
      )}
    </li>
  );
}

function StepReadings({ bill, draft, onReadingSaved, onBack, onNext }: { bill: BillDto; draft: AllocationDraftDto; onReadingSaved: () => void; onBack: () => void; onNext: () => void }) {
  const t = useT();
  const { can } = useCurrentBuilding();
  const [entry, setEntry] = useState<AllocationDraftConsumerDto | null>(null);
  return (
    <StepCard
      title={t('bills.wizard.step.2')}
      description={t('bills.wizard.step2.description', { period: formatPeriod(bill.periodStart, bill.periodEnd) })}
      footer={
        <NavButtons
          onBack={onBack}
          next={
            <Button onClick={onNext}>
              {t('action.next')} <ArrowRight />
            </Button>
          }
        />
      }
    >
      <Alert variant="info">{t('bills.wizard.step2.idealDates')}</Alert>
      <ul className="flex flex-col gap-3">
        {draft.consumers.map((item) => (
          <ConsumerReadings key={item.consumer.id} entry={item} canAdd={can('reading.create')} onAdd={() => setEntry(item)} />
        ))}
      </ul>
      <Sheet open={entry !== null} onOpenChange={(open) => !open && setEntry(null)} title={t('bills.wizard.step2.readingTitle', { meter: entry?.meter?.label ?? '' })}>
        {entry?.meter ? (
          <ReadingForm
            meter={entry.meter}
            onSaved={() => {
              setEntry(null);
              onReadingSaved();
            }}
          />
        ) : null}
      </Sheet>
    </StepCard>
  );
}

// --- Page --------------------------------------------------------------------

export default function NewBillPage() {
  const t = useT();
  const { buildingId, building, membership, can } = useCurrentBuilding();
  const [params, setParams] = useSearchParams();
  const billId = params.get('billId');
  const allocationParam = params.get('allocationId');
  const requested = Number(params.get('step') ?? '1');
  const step: WizardStep = billId ? ((WIZARD_STEPS as readonly number[]).includes(requested) ? (requested as WizardStep) : 2) : 1;

  const [config, setConfig] = useState<AllocationConfig | null>(null);
  const billQuery = useBill(billId);
  const bill = billQuery.data;
  const canCalculate = can('allocation.calculate');
  const draftQuery = useAllocationDraft(billId, step >= 2 && step <= 6 && canCalculate);
  const draft = draftQuery.data;
  const effectiveConfig = config ?? draft?.config ?? null;
  const simulationQuery = useSimulation(billId, step >= 3 && step <= 6 ? effectiveConfig : null, step === 5 ? 400 : 0);
  const workflow = useAllocationWorkflow(bill);
  const allocationId = allocationParam ?? (step === 7 ? (bill?.currentAllocation?.id ?? null) : null);
  const allocationQuery = useAllocation(step >= 6 ? allocationId : null);

  const go = (next: WizardStep, extra: Record<string, string> = {}) =>
    setParams((previous) => {
      const p = new URLSearchParams(previous);
      p.set('step', String(next));
      for (const [key, value] of Object.entries(extra)) p.set(key, value);
      return p;
    });

  if (!buildingId) return <EmptyState title={t('bills.list.noBuilding')} />;
  if (!can('bill.write') && !billId) {
    return (
      <>
        <PageHeader title={t('bills.wizard.title')} />
        <Alert variant="warning">{t('bills.wizard.needBill')}</Alert>
      </>
    );
  }

  const maxReachable: WizardStep = !billId ? 1 : allocationId ? 7 : 6;
  const buildingName = building?.name ?? membership?.buildingName ?? '';
  const simulation = simulationQuery.data;
  const toleranceAr = effectiveConfig?.toleranceAr ?? building?.roundingToleranceAr ?? 2;
  const loading = (billId && billQuery.isLoading) || (step >= 2 && step <= 6 && draftQuery.isLoading);
  const loadError = billQuery.error ?? (step >= 2 && step <= 6 ? draftQuery.error : null);

  const save = async (validateAfter: boolean) => {
    if (!effectiveConfig) return;
    const created = await workflow.save(effectiveConfig);
    if (!created) return;
    if (created.status === 'DRAFT') return;
    if (validateAfter) {
      const validated = await workflow.validate(created.id);
      go(validated ? 7 : 6, { allocationId: created.id });
      return;
    }
    go(7, { allocationId: created.id });
  };

  let content: ReactNode = null;
  if (loading) content = <Spinner />;
  else if (loadError) content = <Alert variant="error">{errorMessage(loadError)}</Alert>;
  else if (step === 1) {
    content = <StepBill buildingId={buildingId} bill={bill} onCreated={(id) => setParams({ billId: id, step: '2' })} onNext={() => go(2)} />;
  } else if (!bill) {
    content = <Alert variant="warning">{t('bills.wizard.needBill')}</Alert>;
  } else if (step <= 6 && (!canCalculate || !draft || !effectiveConfig)) {
    content = canCalculate ? <Spinner /> : <Alert variant="warning">{t('bills.wizard.step6.cannotValidate')}</Alert>;
  } else if (step === 2 && draft) {
    content = <StepReadings bill={bill} draft={draft} onReadingSaved={() => setConfig(null)} onBack={() => go(1)} onNext={() => go(3)} />;
  } else if (step === 3 && draft) {
    content = (
      <StepCard
        title={t('bills.wizard.step.3')}
        description={t('bills.wizard.step3.description')}
        footer={
          <NavButtons
            onBack={() => go(2)}
            next={
              <Button onClick={() => go(4)} disabled={!simulation}>
                {t('action.next')} <ArrowRight />
              </Button>
            }
          />
        }
      >
        <BillSummary bill={bill} />
        <SimulationResult simulation={simulation} isFetching={simulationQuery.isFetching} error={simulationQuery.error} draft={draft} toleranceAr={toleranceAr} />
      </StepCard>
    );
  } else if (step === 4 && draft) {
    content = (
      <StepCard
        title={t('bills.wizard.step.4')}
        description={t('bills.wizard.step4.description')}
        footer={
          <>
            <Button variant="outline" onClick={() => go(3)}>
              <ArrowLeft /> {t('action.previous')}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => go(5)}>
                {t('bills.wizard.step4.adjust')}
              </Button>
              <Button onClick={() => go(6)}>
                {t('bills.wizard.step4.toValidation')} <ArrowRight />
              </Button>
            </div>
          </>
        }
      >
        <SimulationResult simulation={simulation} isFetching={simulationQuery.isFetching} error={simulationQuery.error} draft={draft} toleranceAr={toleranceAr} showChecks={false} />
      </StepCard>
    );
  } else if (step === 5 && draft && effectiveConfig) {
    content = (
      <StepCard
        title={t('bills.wizard.step.5')}
        description={t('bills.wizard.step5.description')}
        footer={
          <NavButtons
            onBack={() => go(4)}
            next={
              <Button onClick={() => go(6)}>
                {t('bills.wizard.step4.toValidation')} <ArrowRight />
              </Button>
            }
          />
        }
      >
        <SimulationPanel
          draft={draft}
          config={effectiveConfig}
          onChange={setConfig}
          simulation={simulation}
          isFetching={simulationQuery.isFetching}
          error={simulationQuery.error}
          split
        />
      </StepCard>
    );
  } else if (step === 6 && draft) {
    const savedAllocation = allocationParam ? allocationQuery.data : undefined;
    const saved = savedAllocation && savedAllocation.status !== 'DRAFT' && savedAllocation.status !== 'SUPERSEDED' ? savedAllocation : undefined;
    const blocked = !simulation?.ok;
    content = (
      <StepCard
        title={t('bills.wizard.step.6')}
        description={t('bills.wizard.step6.description')}
        footer={
          <>
            <Button variant="outline" onClick={() => go(5)}>
              <ArrowLeft /> {t('action.previous')}
            </Button>
            {saved ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => go(7)}>
                  {t('bills.wizard.step6.toRecap')}
                </Button>
                {saved.status === 'CALCULATED' && can('allocation.validate') ? (
                  <Button loading={workflow.isPending} onClick={() => void workflow.validate(saved.id).then((ok) => ok && go(7))}>
                    {t('bills.wizard.step6.validateNow')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {can('allocation.validate') ? (
                  <>
                    <Button variant="outline" disabled={blocked} loading={workflow.isPending} onClick={() => void save(false)}>
                      {t('bills.wizard.step6.save')}
                    </Button>
                    <Button disabled={blocked} loading={workflow.isPending} onClick={() => void save(true)}>
                      {t('bills.wizard.step6.saveAndValidate')}
                    </Button>
                  </>
                ) : (
                  <Button disabled={blocked} loading={workflow.isPending} onClick={() => void save(false)}>
                    {t('bills.wizard.step6.save')}
                  </Button>
                )}
              </div>
            )}
          </>
        }
      >
        {saved && saved.status === 'CALCULATED' ? <Alert variant="warning">{t('bills.wizard.step6.savedNotValidated')}</Alert> : null}
        {blocked && simulation ? <Alert variant="error">{t('bills.wizard.step6.blocked')}</Alert> : null}
        {!can('allocation.validate') ? <Alert variant="info">{t('bills.wizard.step6.cannotValidate')}</Alert> : null}
        <SimulationResult simulation={simulation} isFetching={simulationQuery.isFetching} error={simulationQuery.error} draft={draft} toleranceAr={toleranceAr} />
      </StepCard>
    );
  } else if (step === 7) {
    const allocation = allocationQuery.data;
    content = allocationQuery.isLoading ? (
      <Spinner />
    ) : !allocation ? (
      <Alert variant="warning">{t('bills.detail.noAllocation')}</Alert>
    ) : (
      <div className="grid gap-4">
        <StepCard title={t('bills.wizard.step.7')} description={t('bills.wizard.step7.description')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">{t('allocation.version', { version: allocation.version })}</span>
            <AllocationStatusBadge status={allocation.status} />
          </div>
          {allocation.status !== 'VALIDATED' && allocation.status !== 'LOCKED' ? <Alert variant="warning">{t('bills.wizard.step7.notValidated')}</Alert> : null}
          <ResultTable rows={rowsFromItems(allocation.items)} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to={`/report/${allocation.id}`}>
                <Printer /> {t('allocation.action.report')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/bills/${bill.id}`}>
                <FileText /> {t('bills.wizard.step7.toBill')}
              </Link>
            </Button>
          </div>
        </StepCard>
        <StepCard title={t('whatsapp.title')}>
          <WhatsAppShare allocation={allocation} bill={bill} buildingName={buildingName} />
        </StepCard>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('bills.wizard.title')}
        back={
          <Link to={billId ? `/bills/${billId}` : '/bills'} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {t('bills.detail.back')}
          </Link>
        }
      />
      <Stepper current={step} maxReachable={maxReachable} onSelect={(next) => go(next)} />
      {content}
    </>
  );
}
