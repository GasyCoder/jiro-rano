import { Calculator } from 'lucide-react';
import { useState } from 'react';
import type { CalculationStep } from '@shared/billing/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useT } from '@/i18n';

type Group = { key: string; title: string; steps: CalculationStep[] };

/** Regroupe les étapes : d'abord la facture et les contrôles, puis chaque consommateur, dans l'ordre du calcul. */
export function groupSteps(steps: CalculationStep[], names: Map<string, string>, generalTitle: string): Group[] {
  const groups: Group[] = [];
  const general: Group = { key: 'general', title: generalTitle, steps: [] };
  groups.push(general);
  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    if (!step.consumerId) {
      general.steps.push(step);
      continue;
    }
    let group = groups.find((g) => g.key === step.consumerId);
    if (!group) {
      group = { key: step.consumerId, title: names.get(step.consumerId) ?? step.label.split(' — ')[0] ?? step.consumerId, steps: [] };
      groups.push(group);
    }
    group.steps.push(step);
  }
  return groups.filter((g) => g.steps.length > 0);
}

export function StepLine({ step }: { step: CalculationStep }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-md bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-600">{step.label}</span>
      {step.formula || step.result ? (
        <span className="tabular font-medium break-words text-slate-900">
          {step.formula}
          {step.formula && step.result ? ' = ' : ''}
          {step.result}
        </span>
      ) : null}
    </li>
  );
}

export function CalculationSteps({ steps, names }: { steps: CalculationStep[]; names: Map<string, string> }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      {groupSteps(steps, names, t('allocation.details.general')).map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{group.title}</h3>
          <ol className="flex flex-col gap-1.5">
            {group.steps.map((step) => (
              <StepLine key={step.order} step={step} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Bouton « Voir le détail du calcul » et sa fenêtre. */
export function CalculationDetailsButton({ steps, names, variant = 'outline' }: { steps: CalculationStep[]; names: Map<string, string>; variant?: 'outline' | 'link' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Calculator /> {t('allocation.details.open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('allocation.details.title')} description={t('allocation.details.description')} className="sm:max-w-2xl">
        <CalculationSteps steps={steps} names={names} />
      </Dialog>
    </>
  );
}
