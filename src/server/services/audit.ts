import type { DbOrTx } from '../db/client';
import { auditLogs } from '../db/schema';
import type { RequestMeta } from '../http/context';

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  buildingId?: string | null;
  billId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
};

/** Écrit une ligne d'audit. À appeler dans la même transaction que la modification auditée. */
export async function audit(db: DbOrTx, meta: RequestMeta, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    userId: meta.userId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    buildingId: entry.buildingId ?? null,
    billId: entry.billId ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
  });
}

/** Ne garde que les champs qui ont changé : { avant, après } lisibles dans le journal. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { oldValue: Partial<T>; newValue: Partial<T> } | null {
  const oldValue: Partial<T> = {};
  const newValue: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(normalize(before[key])) !== JSON.stringify(normalize(after[key]))) {
      oldValue[key] = before[key];
      newValue[key] = after[key];
    }
  }
  return Object.keys(newValue).length > 0 ? { oldValue, newValue } : null;
}

/** "443.000" et 443 sont la même valeur pour la comparaison. */
function normalize(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}
