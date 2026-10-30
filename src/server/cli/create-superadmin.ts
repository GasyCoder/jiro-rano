import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { users } from '../db/schema';
import { audit } from '../services/audit';
import { argValue, openCliDatabase, readHidden } from './common';

/**
 * Création (ou promotion) d'un super-administrateur :
 *   npm run create-superadmin -- --email vous@exemple.mg --name "Votre nom"
 * Le mot de passe est demandé sans écho, ou lu dans SUPERADMIN_PASSWORD. Il n'est jamais écrit dans le code.
 */
const email = z.email().parse(argValue('email')).toLowerCase();
const name = z.string().trim().min(1).parse(argValue('name') ?? email.split('@')[0]);
const password = process.env.SUPERADMIN_PASSWORD ?? (await readHidden('Mot de passe (10 caractères minimum) : '));
if (password.length < 10) {
  console.error('✘ Le mot de passe doit contenir au moins 10 caractères');
  process.exit(1);
}

const handle = await openCliDatabase();
try {
  const passwordHash = await hashPassword(password);
  const [existing] = await handle.db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
    .limit(1);
  const meta = { userId: null, ip: null, userAgent: 'cli' };
  if (existing) {
    await handle.db.update(users).set({ role: 'SUPERADMIN', active: true, passwordHash, mustChangePassword: false }).where(eq(users.id, existing.id));
    await audit(handle.db, meta, { action: 'user.promote_superadmin', entityType: 'user', entityId: existing.id, oldValue: { role: existing.role }, newValue: { role: 'SUPERADMIN' } });
    console.log(`✔ ${email} est maintenant super-administrateur (mot de passe mis à jour)`);
  } else {
    const [created] = await handle.db.insert(users).values({ email, name, role: 'SUPERADMIN', passwordHash }).returning({ id: users.id });
    await audit(handle.db, meta, { action: 'user.create_superadmin', entityType: 'user', entityId: created?.id ?? null, newValue: { email, name } });
    console.log(`✔ Super-administrateur créé : ${email}`);
  }
} finally {
  await handle.close();
}
