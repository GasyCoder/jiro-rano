import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AllocationDetailDto, AllocationDraftDto, AllocationSummaryDto, BillDto, SimulationDto } from '@shared/api';
import type { AllocationConfig } from '@shared/schemas';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useBill(billId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.bill(billId ?? 'none'),
    queryFn: () => api<BillDto>(`/api/bills/${billId}`),
    enabled: Boolean(billId),
  });
}

export function useAllocationDraft(billId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.allocationDraft(billId ?? 'none'),
    queryFn: () => api<AllocationDraftDto>(`/api/bills/${billId}/allocation-draft`),
    enabled: Boolean(billId) && enabled,
  });
}

export function useAllocationVersions(billId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.allocations(billId ?? 'none'),
    queryFn: () => api<AllocationSummaryDto[]>(`/api/bills/${billId}/allocations`),
    enabled: Boolean(billId),
  });
}

export function useAllocation(allocationId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.allocation(allocationId ?? 'none'),
    queryFn: () => api<AllocationDetailDto>(`/api/allocations/${allocationId}`),
    enabled: Boolean(allocationId),
  });
}

/** Simulation côté serveur (rien n'est enregistré), relancée après une pause de saisie. */
export function useSimulation(billId: string | null | undefined, config: AllocationConfig | null, debounceMs = 0) {
  const debounced = useDebouncedValue(config, debounceMs);
  return useQuery({
    queryKey: ['simulation', billId, debounced],
    queryFn: ({ signal }) => api<SimulationDto>(`/api/bills/${billId}/allocations/simulate`, { method: 'POST', body: debounced, signal }),
    enabled: Boolean(billId && debounced),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
}

/** Invalide tout ce qui dépend d'une facture et de ses répartitions. */
export function useInvalidateBill() {
  const queryClient = useQueryClient();
  return async (billId: string, buildingId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bill(billId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allocations(billId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allocationDraft(billId) }),
      queryClient.invalidateQueries({ queryKey: ['allocation'] }),
      queryClient.invalidateQueries({ queryKey: ['bills'] }),
      buildingId ? queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(buildingId) }) : Promise.resolve(),
    ]);
  };
}

export function useAllocationMutations(billId: string, buildingId: string | null | undefined) {
  const invalidate = useInvalidateBill();
  const create = useMutation({
    mutationFn: ({ config, correctionReason }: { config: AllocationConfig; correctionReason?: string }) =>
      api<AllocationDetailDto>(`/api/bills/${billId}/allocations`, {
        method: 'POST',
        body: { ...config, ...(correctionReason ? { correctionReason } : {}) },
      }),
    onSettled: () => invalidate(billId, buildingId),
  });
  const validate = useMutation({
    mutationFn: (allocationId: string) => api<AllocationDetailDto>(`/api/allocations/${allocationId}/validate`, { method: 'POST' }),
    onSettled: () => invalidate(billId, buildingId),
  });
  const lock = useMutation({
    mutationFn: (allocationId: string) => api<AllocationDetailDto>(`/api/allocations/${allocationId}/lock`, { method: 'POST' }),
    onSettled: () => invalidate(billId, buildingId),
  });
  return { create, validate, lock };
}

export const isOfficial = (bill: BillDto | null | undefined) =>
  bill?.currentAllocation?.status === 'VALIDATED' || bill?.currentAllocation?.status === 'LOCKED';
