import { and, eq, isNull } from 'drizzle-orm';
import { type BuildingRole, type Permission, PERMISSIONS, permissionsForMember } from '@shared/domain';
import type { DbOrTx } from '../db/client';
import { buildingMembers, buildings } from '../db/schema';
import { forbidden, notFound } from '../http/errors';
import type { AuthUser } from './session';

export type BuildingAccess = {
  buildingId: string;
  role: BuildingRole | 'SUPERADMIN';
  permissions: Set<Permission>;
  consumerId: string | null;
};

export const isSuperadmin = (user: AuthUser) => user.role === 'SUPERADMIN';

/** Droits de l'utilisateur sur un bâtiment, ou null s'il n'y a pas accès (ou si le bâtiment n'existe pas). */
export async function getBuildingAccess(db: DbOrTx, user: AuthUser, buildingId: string): Promise<BuildingAccess | null> {
  const [building] = await db
    .select({ id: buildings.id })
    .from(buildings)
    .where(and(eq(buildings.id, buildingId), isNull(buildings.deletedAt)))
    .limit(1);
  if (!building) return null;
  if (isSuperadmin(user)) {
    return { buildingId, role: 'SUPERADMIN', permissions: new Set(PERMISSIONS), consumerId: null };
  }
  const [member] = await db
    .select()
    .from(buildingMembers)
    .where(and(eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.userId, user.id)))
    .limit(1);
  if (!member) return null;
  return {
    buildingId,
    role: member.role,
    permissions: new Set(permissionsForMember(member.role, member.permissions)),
    consumerId: member.consumerId,
  };
}

/**
 * Vérifie une permission côté serveur. Sans accès au bâtiment : 404 (on ne révèle pas son existence).
 * Avec accès mais sans la permission : 403.
 */
export async function requirePermission(db: DbOrTx, user: AuthUser, buildingId: string, permission: Permission): Promise<BuildingAccess> {
  const access = await getBuildingAccess(db, user, buildingId);
  if (!access) throw notFound('Bâtiment');
  if (!access.permissions.has(permission)) throw forbidden();
  return access;
}

export function requireSuperadmin(user: AuthUser): void {
  if (!isSuperadmin(user)) throw forbidden('Réservé au super-administrateur');
}
