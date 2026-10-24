import { existsSync } from 'node:fs';
import { parseEnv } from '../../config/env.js';
import { createPrismaClient } from '../create-prisma-client.js';
import { generateSeed } from './generate-seed.js';
import { writeDomainData, writeUsers } from './write-seed.js';

// Variables already in the environment win over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = parseEnv(process.env);
const client = createPrismaClient(env.DATABASE_URL);

try {
  if ((await client.user.count()) > 0) {
    process.stdout.write('The database is already seeded.\n');
  } else {
    // A script outside the application: the system time is the clock here.
    const data = generateSeed({ seed: env.SEED, now: new Date() });
    await client.$transaction(
      async (tx) => {
        await writeUsers(tx, data.users);
        await writeDomainData(tx, data);
      },
      { timeout: 60_000 },
    );
    process.stdout.write(
      `Seeded ${data.locations.length} locations, ${data.rooms.length} rooms, ` +
        `${data.members.length} members and ${data.bookings.length} bookings.\n`,
    );
  }
} finally {
  await client.$disconnect();
}
