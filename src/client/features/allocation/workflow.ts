import type { AllocationDetailDto, BillDto } from '@shared/api';
import type { AllocationConfig } from '@shared/schemas';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { ApiClientError, errorMessage } from '@/lib/api';
import { isOfficial, useAllocationMutations } from './hooks';

/**
 * Actions sur les répartitions avec confirmations explicites : une correction d'une répartition
 * officielle exige une raison (enregistrée dans l'audit), la validation et le verrouillage sont confirmés.
 */
export function useAllocationWorkflow(bill: BillDto | undefined) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { create, validate, lock } = useAllocationMutations(bill?.id ?? '', bill?.buildingId);

  const describeError = (error: unknown) => {
    const message = errorMessage(error);
    if (error instanceof ApiClientError && error.status === 409 && /relev/i.test(message)) return `${message} ${t('allocation.readingsHelp')}`;
    return message;
  };

  const save = async (config: AllocationConfig, options: { askConfirm?: boolean } = {}): Promise<AllocationDetailDto | null> => {
    if (!bill) return null;
    let correctionReason: string | undefined;
    if (isOfficial(bill)) {
      const answer = await confirm({
        title: t('allocation.confirm.correctionTitle'),
        description: t('allocation.confirm.correctionDescription'),
        requireReason: true,
        reasonLabel: t('allocation.confirm.correctionReason'),
        confirmLabel: t('allocation.action.recalculate'),
      });
      if (!answer.confirmed) return null;
      correctionReason = answer.reason;
    } else if (options.askConfirm) {
      const answer = await confirm({ title: t('allocation.confirm.recalculateTitle'), description: t('allocation.confirm.recalculateDescription'), confirmLabel: t('allocation.action.recalculate') });
      if (!answer.confirmed) return null;
    }
    try {
      const allocation = await create.mutateAsync({ config, ...(correctionReason ? { correctionReason } : {}) });
      if (allocation.status === 'DRAFT') toast.error(t('allocation.toast.draft'));
      else toast.success(t('allocation.toast.created', { version: allocation.version }));
      return allocation;
    } catch (error) {
      toast.error(describeError(error));
      return null;
    }
  };

  const validateAllocation = async (allocationId: string, options: { skipConfirm?: boolean } = {}): Promise<AllocationDetailDto | null> => {
    if (!options.skipConfirm) {
      const answer = await confirm({ title: t('allocation.confirm.validateTitle'), description: t('allocation.confirm.validateDescription'), confirmLabel: t('allocation.action.validate') });
      if (!answer.confirmed) return null;
    }
    try {
      const allocation = await validate.mutateAsync(allocationId);
      toast.success(t('allocation.toast.validated'));
      return allocation;
    } catch (error) {
      toast.error(describeError(error));
      return null;
    }
  };

  const lockAllocation = async (allocationId: string): Promise<AllocationDetailDto | null> => {
    const answer = await confirm({ title: t('allocation.confirm.lockTitle'), description: t('allocation.confirm.lockDescription'), confirmLabel: t('allocation.action.lock'), destructive: true });
    if (!answer.confirmed) return null;
    try {
      const allocation = await lock.mutateAsync(allocationId);
      toast.success(t('allocation.toast.locked'));
      return allocation;
    } catch (error) {
      toast.error(describeError(error));
      return null;
    }
  };

  return {
    save,
    validate: validateAllocation,
    lock: lockAllocation,
    isPending: create.isPending || validate.isPending || lock.isPending,
  };
}
