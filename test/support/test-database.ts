import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  url: string;
  drop: () => Promise<void>;
}

const SOURCE_IN_USE = '55006';

const withAdmin = async <T>(work: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: inject('databaseServer').adminUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

/**
 * A private copy of the migrated and seeded template, so a test file can change data freely.
 * Copying fails with 55006 while another copy is being made from the same template; retry.
 */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  const { adminUrl, template } = inject('databaseServer');
  const name = `cw_${randomUUID().replaceAll('-', '')}`;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await withAdmin((client) => client.query(`CREATE DATABASE ${name} TEMPLATE ${template}`));
      break;
    } catch (error) {
      const busy = error instanceof Error && 'code' in error && error.code === SOURCE_IN_USE;
      if (!busy || attempt === 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () =>
      withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).then(
        () => undefined,
      ),
  };
};
