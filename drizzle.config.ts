// drizzle-kit config (Stage 1). Used by `npm run db:generate` (author SQL from
// schema.ts) and `npm run db:studio`. The runtime migrate step (`npm run
// db:migrate`) applies the .sql files directly and does not require this file.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
