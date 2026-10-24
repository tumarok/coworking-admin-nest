import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from './create-prisma-client.js';

/** The queries of a transaction callback: everything a client offers except the lifecycle. */
export type DbClient = Prisma.TransactionClient;

/**
 * The application's database access. The pool opens connections lazily, so creating the service
 * never fails and a missing database shows up on the first query (and in `/health`).
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
