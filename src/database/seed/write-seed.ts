import * as argon2 from 'argon2';
import { sequenceOf } from '../../common/ids/ids.js';
import type { User } from '../../contract/index.js';
import type { DbClient } from '../prisma.service.js';
import { DEMO_PASSWORD, type SeedData } from './generate-seed.js';

const seqOf = (id: string) => BigInt(sequenceOf(id));

/** Inserts the demo users; the password hash is argon2id, so this is the slow part of a seed. */
export const writeUsers = async (client: DbClient, users: User[]): Promise<void> => {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  await client.user.createMany({ data: users.map((user) => ({ ...user, passwordHash })) });
};

/**
 * Inserts the records in bulk, parents first, and moves `entity_seq` to the generator's last value
 * so the next created entity continues the numbering. The tables must be empty.
 */
export const writeDomainData = async (client: DbClient, data: SeedData): Promise<void> => {
  await client.location.createMany({
    data: data.locations.map((location) => ({ ...location, seq: seqOf(location.id) })),
  });
  await client.room.createMany({
    data: data.rooms.map((room) => ({ ...room, seq: seqOf(room.id) })),
  });
  await client.member.createMany({
    data: data.members.map((member) => ({
      ...member,
      seq: seqOf(member.id),
      joinedAt: new Date(member.joinedAt),
    })),
  });
  await client.booking.createMany({
    data: data.bookings.map((booking) => ({
      ...booking,
      seq: seqOf(booking.id),
      startsAt: new Date(booking.startsAt),
      endsAt: new Date(booking.endsAt),
      createdAt: new Date(booking.createdAt),
    })),
  });
  // `setval` is not transactional: the counter moves even if a surrounding transaction rolls back.
  await client.$queryRaw`SELECT setval('entity_seq', ${data.sequence}::bigint)`;
};
