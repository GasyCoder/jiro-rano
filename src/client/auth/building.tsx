import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type { BuildingDto, MembershipDto } from '@shared/api';
import type { Permission } from '@shared/domain';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { safeStorage } from '@/lib/utils';
import { useAuth } from './auth';

const STORAGE_KEY = 'jirama-share.building';

type BuildingContextValue = {
  buildingId: string | null;
  membership: MembershipDto | null;
  building: BuildingDto | null;
  isLoading: boolean;
  setBuildingId: (id: string) => void;
  can: (permission: Permission) => boolean;
};

const BuildingContext = createContext<BuildingContextValue | null>(null);

/** Bâtiment actif, mémorisé sur cet appareil. Toutes les pages travaillent sur ce bâtiment. */
export function BuildingProvider({ children }: { children: ReactNode }) {
  const { memberships, can } = useAuth();
  const [stored, setStored] = useState<string | null>(() => safeStorage.get(STORAGE_KEY));
  const membership = memberships.find((m) => m.buildingId === stored) ?? memberships[0] ?? null;
  const buildingId = membership?.buildingId ?? null;

  const buildingQuery = useQuery({
    queryKey: queryKeys.building(buildingId ?? 'none'),
    queryFn: () => api<BuildingDto>(`/api/buildings/${buildingId}`),
    enabled: Boolean(buildingId),
  });

  const setBuildingId = useCallback((id: string) => {
    safeStorage.set(STORAGE_KEY, id);
    setStored(id);
  }, []);

  const value = useMemo<BuildingContextValue>(
    () => ({
      buildingId,
      membership,
      building: buildingQuery.data ?? null,
      isLoading: buildingQuery.isLoading,
      setBuildingId,
      can: (permission) => can(permission, buildingId),
    }),
    [buildingId, membership, buildingQuery.data, buildingQuery.isLoading, setBuildingId, can],
  );

  return <BuildingContext.Provider value={value}>{children}</BuildingContext.Provider>;
}

export function useCurrentBuilding(): BuildingContextValue {
  const context = useContext(BuildingContext);
  if (!context) throw new Error('useCurrentBuilding doit être utilisé dans BuildingProvider');
  return context;
}
