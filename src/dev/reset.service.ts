import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { generateSeed } from '../database/seed/generate-seed.js';
import { writeDomainData } from '../database/seed/write-seed.js';

// Any constant: concurrent resets queue on it instead of interleaving their inserts.
const RESET_LOCK = 4_242_001;

@Injectable()
export class ResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Rebuilds the locations, rooms, members and bookings from the seed, around the clock's "now".
   * Users stay (their hashes are slow to make and tokens must outlive a reset). The records are
   * generated before the transaction so it holds its locks for as short a time as possible.
   */
  async reset(): Promise<void> {
    const data = generateSeed({ seed: this.env.SEED, now: this.clock.now() });
    await this.prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESET_LOCK})`;
        await tx.$executeRaw`TRUNCATE bookings, rooms, members, locations`;
        await writeDomainData(tx, data);
      },
      { timeout: 30_000 },
    );
  }
}
