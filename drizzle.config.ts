import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` n'a pas besoin de connexion : il compare le schéma TypeScript
// aux migrations déjà générées dans ./drizzle. Les migrations sont appliquées par
// `npm run db:migrate` (voir src/server/cli/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
});
