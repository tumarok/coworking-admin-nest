import { SEED_NOW } from './constants.js';
import { testApp, type TestApp } from './test-app.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

export interface SeededApp extends TestApp {
  database: TestDatabase;
}

/**
 * The application on a private copy of the seeded template, with the clock frozen at the instant
 * the template was built (or at `now`). `close()` stops the application and drops the copy.
 */
export const seededApp = async (
  env: Record<string, string | undefined> = {},
  now: Date = SEED_NOW,
): Promise<SeededApp> => {
  const database = await createTestDatabase();
  const api = await testApp({ DATABASE_URL: database.url, ...env }, { now });
  return {
    ...api,
    database,
    close: async () => {
      await api.close();
      await database.drop();
    },
  };
};
