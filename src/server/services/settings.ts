import { eq } from 'drizzle-orm';
import { type AppSettings, SettingsSchema } from '@shared/schemas';
import type { DbOrTx } from '../db/client';
import { appSettings } from '../db/schema';

const KEY = 'app';

export const DEFAULT_SETTINGS: AppSettings = {
  defaultToleranceAr: 2,
  defaultWaterMode: 'EQUAL',
  managersCanOverride: true,
};

export async function getSettings(db: DbOrTx): Promise<AppSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const parsed = SettingsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveSettings(db: DbOrTx, settings: AppSettings, userId: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: settings, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedBy: userId, updatedAt: new Date() } });
}
