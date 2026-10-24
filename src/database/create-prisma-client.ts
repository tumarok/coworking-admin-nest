import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/** A client on its own connection pool; the session runs in UTC so `timestamptz` reads are stable. */
export const createPrismaClient = (databaseUrl: string): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, options: '-c TimeZone=UTC' }),
  });
