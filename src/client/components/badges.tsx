import type { AllocationStatus, CalculationStatus, Provenance } from '@shared/domain';
import { ALLOCATION_STATUS_LABELS, CALCULATION_STATUS_LABELS, PROVENANCE_DESCRIPTIONS } from '@shared/labels';
import { useT } from '@/i18n';
import { Badge, type BadgeProps } from './ui/badge';

type Variant = NonNullable<BadgeProps['variant']>;

const PROVENANCE_VARIANT: Record<Provenance, Variant> = {
  MEASURED: 'measured',
  PRORATED: 'prorated',
  ESTIMATED: 'estimated',
  MANUAL: 'manual',
  DIFFERENCE: 'computed',
};

/** Badge Mesuré / Proratisé / Estimé / Manuel / Calculé : la provenance de chaque valeur reste visible. */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const t = useT();
  return (
    <Badge variant={PROVENANCE_VARIANT[provenance]} title={PROVENANCE_DESCRIPTIONS[provenance]}>
      {t(`provenance.${provenance}`)}
    </Badge>
  );
}

const ALLOCATION_VARIANT: Record<AllocationStatus, Variant> = {
  DRAFT: 'danger',
  CALCULATED: 'prorated',
  VALIDATED: 'validated',
  LOCKED: 'validated',
  SUPERSEDED: 'neutral',
};

export function AllocationStatusBadge({ status }: { status: AllocationStatus }) {
  return <Badge variant={ALLOCATION_VARIANT[status]}>{ALLOCATION_STATUS_LABELS[status]}</Badge>;
}

const CALCULATION_VARIANT: Record<CalculationStatus, Variant> = {
  NOT_CALCULATED: 'neutral',
  CALCULATED: 'prorated',
  VALIDATED: 'validated',
  LOCKED: 'validated',
  OUTDATED: 'warning',
};

export function CalculationStatusBadge({ status }: { status: CalculationStatus }) {
  return <Badge variant={CALCULATION_VARIANT[status]}>{CALCULATION_STATUS_LABELS[status]}</Badge>;
}

export function ValidatedBadge({ validated }: { validated: boolean }) {
  const t = useT();
  return validated ? <Badge variant="validated">{t('status.validated')}</Badge> : <Badge variant="warning">À valider</Badge>;
}
