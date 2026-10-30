import { Check } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export const WIZARD_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Indicateur d'étape : compact sur mobile, liste complète sur grand écran. */
export function Stepper({ current, maxReachable, onSelect }: { current: WizardStep; maxReachable: WizardStep; onSelect: (step: WizardStep) => void }) {
  const t = useT();
  return (
    <nav aria-label={t('bills.wizard.stepOf', { current, total: WIZARD_STEPS.length })} className="mb-5">
      <div className="flex items-center justify-between text-sm md:hidden">
        <span className="font-medium text-slate-900">{t(`bills.wizard.step.${current}`)}</span>
        <span className="text-slate-500">{t('bills.wizard.stepOf', { current, total: WIZARD_STEPS.length })}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 md:hidden">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${(current / WIZARD_STEPS.length) * 100}%` }} />
      </div>
      <ol className="hidden items-center gap-1 md:flex">
        {WIZARD_STEPS.map((step) => {
          const done = step < current;
          const reachable = step <= maxReachable;
          return (
            <li key={step} className="flex flex-1 items-center gap-1">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(step)}
                aria-current={step === current ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed',
                  step === current ? 'bg-brand-50 text-brand-800' : reachable ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-400',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]',
                    step === current ? 'border-brand-700 bg-brand-700 text-white' : done ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300',
                  )}
                >
                  {done ? <Check className="size-3.5" /> : step}
                </span>
                <span className="truncate">{t(`bills.wizard.step.${step}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
