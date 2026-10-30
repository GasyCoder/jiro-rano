import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/session';
import { hashPassword } from '../auth/password';
import { bills, buildings, consumers, meterReadings, meters, users } from '../db/schema';
import { persistAllocation, resolveEngineInput } from '../services/allocations';
import { DEFAULT_SETTINGS } from '../services/settings';
import { openCliDatabase } from './common';

/**
 * Données de démonstration : bâtiment Mangarivotra, 3 consommateurs, la facture d'octobre 2026
 * et une première répartition d'exemple (RDC 168 kWh et 2e 164 kWh saisis comme ESTIMATIONS,
 * 1er étage par différence = 111 kWh). Idempotent : ne fait rien si le bâtiment existe déjà.
 */
const BUILDING_NAME = 'Mangarivotra';
const handle = await openCliDatabase();
const { db } = handle;

try {
  let [admin] = await db.select().from(users).where(and(eq(users.role, 'SUPERADMIN'), eq(users.active, true), isNull(users.deletedAt))).limit(1);
  if (!admin) {
    const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@jirama.local').toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
    [admin] = await db
      .insert(users)
      .values({ email, name: 'Administrateur démo', role: 'SUPERADMIN', passwordHash: await hashPassword(password), mustChangePassword: !process.env.SEED_ADMIN_PASSWORD })
      .returning();
    console.log(`✔ Super-administrateur de démonstration : ${email}`);
    if (!process.env.SEED_ADMIN_PASSWORD) console.log(`  Mot de passe provisoire (à changer à la première connexion) : ${password}`);
  }
  if (!admin) throw new Error('Impossible de créer le super-administrateur');

  const [existing] = await db.select({ id: buildings.id }).from(buildings).where(and(eq(buildings.name, BUILDING_NAME), isNull(buildings.deletedAt))).limit(1);
  if (existing) {
    console.log(`ℹ Le bâtiment « ${BUILDING_NAME} » existe déjà : rien à faire.`);
  } else {
    const user: AuthUser = { id: admin.id, email: admin.email, name: admin.name, role: 'SUPERADMIN', locale: admin.locale, mustChangePassword: false };
    const meta = { userId: admin.id, ip: null, userAgent: 'seed' };
    await db.transaction(async (tx) => {
      const [building] = await tx
        .insert(buildings)
        .values({ name: BUILDING_NAME, address: 'Mangarivotra, Mahajanga', description: 'Bâtiment de démonstration : RDC, 1er et 2e étage', createdBy: admin.id })
        .returning();
      if (!building) throw new Error('Création du bâtiment impossible');
      await tx.insert(meters).values({ buildingId: building.id, type: 'MAIN', label: 'Compteur principal JIRAMA', normalization: 'AS_IS' });
      const [rdcMeter, secondMeter] = await tx
        .insert(meters)
        .values([
          { buildingId: building.id, type: 'SUB_METER', label: 'Sous-compteur RDC', rolloverAt: '10000' },
          { buildingId: building.id, type: 'SUB_METER', label: 'Sous-compteur 2e étage', rolloverAt: '10000' },
        ])
        .returning();
      if (!rdcMeter || !secondMeter) throw new Error('Création des compteurs impossible');
      const [rdc, first, second] = await tx
        .insert(consumers)
        .values([
          { buildingId: building.id, name: 'RDC', type: 'FLOOR', sortOrder: 0, meterId: rdcMeter.id, allocationMode: 'SUB_METER' },
          { buildingId: building.id, name: '1er étage', type: 'FLOOR', sortOrder: 1, allocationMode: 'DIFFERENCE', description: 'Pas de sous-compteur : calculé par différence' },
          { buildingId: building.id, name: '2e étage', type: 'FLOOR', sortOrder: 2, meterId: secondMeter.id, allocationMode: 'SUB_METER' },
        ])
        .returning();
      if (!rdc || !first || !second) throw new Error('Création des consommateurs impossible');

      // Relevés réels lus sur les photos (partie entière uniquement pour le calcul).
      const validated = { validated: true, validatedBy: admin.id, validatedAt: new Date(), createdBy: admin.id };
      await tx.insert(meterReadings).values([
        { ...validated, meterId: rdcMeter.id, readingDate: '2026-09-24', readingTime: '21:05:57', value: '4757', normalizedValue: '4757', notes: 'Photo du 24/09/2026 21:05 (EXIF)' },
        { ...validated, meterId: rdcMeter.id, readingDate: '2026-09-29', readingTime: '09:07:20', value: '4801', normalizedValue: '4801', notes: 'Unités en rotation entre 0 et 1, dixièmes 9→0 : valeur réelle ≈ 4800,9' },
        { ...validated, meterId: secondMeter.id, readingDate: '2026-08-27', readingTime: '16:18:00', value: '8073.3', normalizedValue: '8073', notes: 'Heure d’envoi WhatsApp' },
        { ...validated, meterId: secondMeter.id, readingDate: '2026-09-27', readingTime: '14:25:00', value: '8092.3', normalizedValue: '8092', notes: 'Heure d’envoi WhatsApp' },
      ]);

      const [bill] = await tx
        .insert(bills)
        .values({
          buildingId: building.id,
          periodStart: '2026-08-27',
          periodEnd: '2026-09-26',
          days: 30,
          mainMeterPreviousIndex: '50898',
          mainMeterCurrentIndex: '51311',
          electricityKwh: '443',
          electricityAmount: '328798.76',
          waterAmount: '3770',
          totalAmount: '332568.76',
          invoiceNumber: 'DEMO-2026-10',
          invoiceDate: '2026-10-09',
          dueDate: '2026-10-21',
          status: 'CONFIRMED',
          notes: 'Index imprimé 51 311 (soit 413 kWh) alors que 443 kWh sont facturés : à vérifier sur la facture papier.',
          createdBy: admin.id,
        })
        .returning();
      if (!bill) throw new Error('Création de la facture impossible');

      const config = {
        consumers: [
          { consumerId: rdc.id, method: 'MANUAL_APPROXIMATION' as const, manualKwh: 168 },
          { consumerId: first.id, method: 'DIFFERENCE' as const },
          { consumerId: second.id, method: 'MANUAL_APPROXIMATION' as const, manualKwh: 164 },
        ],
        water: { mode: 'EQUAL' as const },
        toleranceAr: 2,
      };
      const resolved = await resolveEngineInput(tx, bill, config, user, DEFAULT_SETTINGS);
      await persistAllocation(tx, { bill, user, meta, config, resolved });
    });
    console.log(`✔ Démonstration « ${BUILDING_NAME} » créée (facture d'octobre 2026, répartition d'exemple 168 / 111 / 164 kWh)`);
  }
} finally {
  await handle.close();
}
