import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api';

/** Clés de cache centralisées : invalider la bonne clé après chaque mutation. */
export const queryKeys = {
  me: ['me'] as const,
  buildings: ['buildings'] as const,
  building: (id: string) => ['building', id] as const,
  dashboard: (buildingId: string) => ['dashboard', buildingId] as const,
  members: (buildingId: string) => ['members', buildingId] as const,
  consumers: (buildingId: string, includeInactive = false) => ['consumers', buildingId, includeInactive] as const,
  meters: (buildingId: string) => ['meters', buildingId] as const,
  readings: (meterId: string) => ['readings', meterId] as const,
  bills: (buildingId: string) => ['bills', buildingId] as const,
  bill: (id: string) => ['bill', id] as const,
  allocationDraft: (billId: string) => ['allocation-draft', billId] as const,
  allocations: (billId: string) => ['allocations', billId] as const,
  allocation: (id: string) => ['allocation', id] as const,
  users: ['users'] as const,
  audit: (params: Record<string, string | number | undefined>) => ['audit', params] as const,
  settings: ['settings'] as const,
};

const onUnauthorized = (error: unknown) => {
  if (error instanceof ApiClientError && error.status === 401) queryClient.setQueryData(queryKeys.me, null);
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiClientError && error.status < 500) && count < 2,
    },
  },
});
