import type { Response } from 'supertest';
import type { DbClient, PrismaService } from '../../src/database/prisma.service.js';

/** Whether a backend of this database is blocked on a lock. */
const lockWaiting = async (prisma: PrismaService) => {
  const rows = await prisma.client.$queryRaw<{ waiting: number }[]>`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return (rows.at(0)?.waiting ?? 0) > 0;
};

/**
 * Sends `request` while `hold` has uncommitted writes, and ends the transaction (commit, or
 * rollback with `commit: false`) once the request waits for them; `whileQueued` runs just before,
 * to look at what the waiting request holds. Returns the response.
 */
export const queuedBehind = async (
  prisma: PrismaService,
  hold: (tx: DbClient) => Promise<void>,
  request: () => PromiseLike<Response>,
  { commit = true, whileQueued }: { commit?: boolean; whileQueued?: () => Promise<void> } = {},
): Promise<Response> => {
  let queued: Promise<Response> | undefined;
  class Rollback extends Error {}
  try {
    await prisma.client.$transaction(async (tx) => {
      await hold(tx);
      queued = Promise.resolve(request());
      queued.catch(() => undefined);
      for (let attempt = 0; attempt < 100 && !(await lockWaiting(prisma)); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await lockWaiting(prisma)).toBe(true);
      await whileQueued?.();
      if (!commit) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (queued === undefined) throw new Error('The request was not sent');
  return queued;
};
