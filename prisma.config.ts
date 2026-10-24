import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma does not read `.env` itself; variables already in the environment win over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` needs no database, so a missing URL must not stop it.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
