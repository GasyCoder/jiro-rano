import { CheckCircle2, XCircle } from 'lucide-react';
import type { SimulationDto } from '@shared/api';
import type { AllocationIssue } from '@shared/billing/types';
import { Alert } from '@/components/ui/feedback';
import { useT } from '@/i18n';
import { formatAriary, formatKwh } from '@/lib/format';
import { cn } from '@/lib/utils';
import { sameCents, sameWh } from './rows';

/** Erreurs bloquantes et avertissements du moteur, en clair. */
export function IssuesList({ errors, warnings }: { errors: AllocationIssue[]; warnings: AllocationIssue[] }) {
  const t = useT();
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {errors.length > 0 ? (
        <Alert variant="error" title={t('allocation.issues.errors')}>
          <ul className="flex flex-col gap-1">
            {errors.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>• {issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert variant="warning" title={t('allocation.issues.warnings')}>
          <ul className="flex flex-col gap-1">
            {warnings.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>• {issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={cn('flex items-start gap-2 text-sm', ok ? 'text-emerald-800' : 'text-red-700')}>
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
      <span>{label}</span>
    </li>
  );
}

/** Contrôles de cohérence d'une simulation par rapport à la facture. */
export function SimulationChecks({
  simulation,
  bill,
  toleranceAr,
}: {
  simulation: SimulationDto;
  bill: { electricityKwh: number; electricityAmount: number; totalAmount: number };
  toleranceAr: number;
}) {
  const t = useT();
  if (!simulation.ok) return <Alert variant="error">{t('allocation.checks.failed')}</Alert>;
  const sumWh = simulation.consumers.reduce((s, c) => s + c.wh, 0) / 1000;
  const sumElectricity = simulation.consumers.reduce((s, c) => s + c.centimes.electricity, 0) / 100;
  const sumTotal = simulation.consumers.reduce((s, c) => s + c.centimes.total, 0) / 100;
  return (
    <ul className="flex flex-col gap-1.5">
      <Check ok={sameWh(sumWh, bill.electricityKwh)} label={t('allocation.checks.kwh', { total: formatKwh(bill.electricityKwh) })} />
      <Check ok={sameCents(sumElectricity, bill.electricityAmount)} label={t('allocation.checks.electricity', { total: formatAriary(bill.electricityAmount) })} />
      <Check
        ok={sameCents(sumTotal, bill.totalAmount, toleranceAr)}
        label={t('allocation.checks.total', { total: formatAriary(bill.totalAmount), tolerance: formatAriary(toleranceAr) })}
      />
    </ul>
  );
}
