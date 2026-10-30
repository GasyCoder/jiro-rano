import type { AllocationDraftDto, SimulationDto } from '@shared/api';
import type { AllocationConfig } from '@shared/schemas';
import { Alert, Spinner } from '@/components/ui/feedback';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AllocationEditor } from './AllocationEditor';
import { CalculationDetailsButton } from './CalculationDetails';
import { IssuesList, SimulationChecks } from './Issues';
import { ResultTable } from './ResultTable';
import { rowsFromSimulation } from './rows';

export function simulationNames(simulation: SimulationDto | undefined): Map<string, string> {
  if (!simulation) return new Map();
  return new Map(simulation.ok ? simulation.consumers.map((c) => [c.consumerId, c.name]) : simulation.partial.map((p) => [p.consumerId, p.name]));
}

export function simulationKwh(simulation: SimulationDto | undefined): Map<string, number> {
  if (!simulation?.ok) return new Map();
  return new Map(simulation.consumers.map((c) => [c.consumerId, c.kwh]));
}

/** Résultat d'une simulation : contrôles, tableau, avertissements, détail du calcul. */
export function SimulationResult({
  simulation,
  isFetching,
  error,
  draft,
  toleranceAr,
  showChecks = true,
}: {
  simulation: SimulationDto | undefined;
  isFetching: boolean;
  error: unknown;
  draft: AllocationDraftDto;
  toleranceAr: number;
  showChecks?: boolean;
}) {
  const t = useT();
  if (error) {
    return (
      <Alert variant="error" title={t('allocation.simulation.invalid')}>
        {errorMessage(error)}
      </Alert>
    );
  }
  if (!simulation) return <Spinner label={t('allocation.simulation.running')} />;
  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', isFetching && 'opacity-60')}>
      {showChecks ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">{t('allocation.checks.title')}</p>
          <SimulationChecks simulation={simulation} bill={draft.bill} toleranceAr={toleranceAr} />
        </div>
      ) : null}
      {simulation.ok ? (
        <>
          <ResultTable rows={rowsFromSimulation(simulation.consumers)} showMethod />
          <p className="text-xs text-slate-500">
            {t('allocation.effectivePrice', { price: formatNumber(simulation.effectivePricePerKwh, 2) })} {t('allocation.payableNote')}
          </p>
        </>
      ) : null}
      <IssuesList errors={simulation.errors} warnings={simulation.warnings} />
      <div>
        <CalculationDetailsButton steps={simulation.calculationDetails} names={simulationNames(simulation)} />
      </div>
    </div>
  );
}

/** Éditeur + résultat recalculé en direct (simulation : rien n'est enregistré). */
export function SimulationPanel({
  draft,
  config,
  onChange,
  simulation,
  isFetching,
  error,
  split = false,
}: {
  draft: AllocationDraftDto;
  config: AllocationConfig;
  onChange: (config: AllocationConfig) => void;
  simulation: SimulationDto | undefined;
  isFetching: boolean;
  error: unknown;
  split?: boolean;
}) {
  return (
    <div className={cn('grid gap-6', split && 'lg:grid-cols-2 lg:items-start')}>
      <AllocationEditor draft={draft} config={config} onChange={onChange} currentKwh={simulationKwh(simulation)} />
      <div className={cn(split && 'lg:sticky lg:top-4')}>
        <SimulationResult simulation={simulation} isFetching={isFetching} error={error} draft={draft} toleranceAr={config.toleranceAr ?? 2} />
      </div>
    </div>
  );
}
