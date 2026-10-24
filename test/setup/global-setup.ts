import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createPrismaClient } from '../../src/database/create-prisma-client.js';
import { generateSeed } from '../../src/database/seed/generate-seed.js';
import { writeDomainData, writeUsers } from '../../src/database/seed/write-seed.js';
import { SEED, SEED_NOW } from '../support/constants.js';

export const TEMPLATE_DATABASE = 'coworking_template';

/** What the tests may ask for: the server to create databases on and the template to copy. */
export interface TestDatabaseServer {
  adminUrl: string;
  template: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseServer: TestDatabaseServer;
  }
}

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'prisma', 'migrations');

const withClient = async <T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

const urlFor = (adminUrl: string, database: string) => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

/**
 * One PostgreSQL container for the whole run. It builds a template database (migrations and the
 * seed at a fixed instant) that every test file copies with `CREATE DATABASE ... TEMPLATE`, which
 * is far cheaper than migrating and seeding again.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    // Same collation as compose: lists sort the way the mock API's locale-aware sort does.
    .withEnvironment({ POSTGRES_INITDB_ARGS: '--locale-provider=icu --icu-locale=und' })
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'full_page_writes=off'])
    .withStartupTimeout(180_000)
    .start();
  const adminUrl = container.getConnectionUri();

  await withClient(adminUrl, (client) => client.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`));
  const templateUrl = urlFor(adminUrl, TEMPLATE_DATABASE);

  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  await withClient(templateUrl, async (client) => {
    for (const name of migrations) {
      await client.query(readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'));
    }
  });

  const prisma = createPrismaClient(templateUrl);
  try {
    const data = generateSeed({ seed: SEED, now: SEED_NOW });
    await prisma.$transaction(
      async (tx) => {
        await writeUsers(tx, data.users);
        await writeDomainData(tx, data);
      },
      { timeout: 60_000 },
    );
  } finally {
    // A template cannot be copied while anything is connected to it.
    await prisma.$disconnect();
  }

  project.provide('databaseServer', { adminUrl, template: TEMPLATE_DATABASE });
  return async () => {
    await container.stop();
  };
}
