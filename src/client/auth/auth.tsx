import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { MeDto, MembershipDto, UserDto } from '@shared/api';
import type { Permission } from '@shared/domain';
import { Spinner } from '@/components/ui/feedback';
import { api, ApiClientError } from '@/lib/api';
import { queryKeys } from '@/lib/query';

type AuthContextValue = {
  me: MeDto | null;
  user: UserDto | null;
  memberships: MembershipDto[];
  isSuperadmin: boolean;
  isLoading: boolean;
  /** Droit côté interface (masquage). Le serveur reste seul juge. */
  can: (permission: Permission, buildingId: string | null | undefined) => boolean;
  login: (email: string, password: string) => Promise<MeDto>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<MeDto | null> {
  try {
    return await api<MeDto>('/api/auth/me');
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, staleTime: 60_000, retry: false });
  const me = meQuery.data ?? null;

  // On vide le cache des données de l'ancien utilisateur, mais jamais la requête « me » elle-même :
  // la supprimer détacherait l'observateur de session et ramènerait l'écran de connexion.
  const resetSession = useCallback(
    (me: MeDto | null) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
      queryClient.setQueryData(queryKeys.me, me);
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api<MeDto>('/api/auth/login', { method: 'POST', body: { email, password } });
      resetSession(result);
      return result;
    },
    [resetSession],
  );

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    resetSession(null);
  }, [resetSession]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const memberships = me?.memberships ?? [];
    const isSuperadmin = me?.user.role === 'SUPERADMIN';
    return {
      me,
      user: me?.user ?? null,
      memberships,
      isSuperadmin,
      isLoading: meQuery.isLoading,
      can: (permission, buildingId) =>
        isSuperadmin || Boolean(buildingId && memberships.find((m) => m.buildingId === buildingId)?.permissions.includes(permission)),
      login,
      logout,
      refresh,
    };
  }, [me, meQuery.isLoading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return context;
}

/** Garde de route : connexion obligatoire, puis changement de mot de passe si exigé. */
export function RequireAuth() {
  const { me, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <Spinner className="min-h-dvh" />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me.user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RequireSuperadmin() {
  const { isSuperadmin } = useAuth();
  return isSuperadmin ? <Outlet /> : <Navigate to="/" replace />;
}
