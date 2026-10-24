import * as argon2 from 'argon2';
import { sequenceOf } from '../../common/ids/ids.js';
import type { User } from '../../contract/index.js';
import type { DbClient } from '../prisma.service.js';
import { type BookingRecord, DEMO_PASSWORD, type SeedData } from './generate-seed.js';

const seqOf = (id: string) => BigInt(sequenceOf(id));

/**
 * One statement for all bookings: Prisma's `createMany` builds a query per row batch and takes
 * about half a second for the seed, which would make every e2e `reset` too slow.
 */
const insertBookings = async (client: DbClient, bookings: BookingRecord[]): Promise<void> => {
  const column = <T>(pick: (booking: BookingRecord) => T) => bookings.map(pick);
  await client.$executeRaw`
    INSERT INTO bookings (id, seq, room_id, member_id, starts_at, ends_at, attendees, status,
                          notes, total_price, created_at)
    SELECT * FROM unnest(
      ${column((b) => b.id)}::text[],
      ${column((b) => sequenceOf(b.id))}::bigint[],
      ${column((b) => b.roomId)}::text[],
      ${column((b) => b.memberId)}::text[],
      ${column((b) => b.startsAt)}::timestamptz[],
      ${column((b) => b.endsAt)}::timestamptz[],
      ${column((b) => b.attendees)}::integer[],
      ${column((b) => b.status)}::booking_status[],
      ${column((b) => b.notes)}::text[],
      ${column((b) => b.totalPrice)}::integer[],
      ${column((b) => b.createdAt)}::timestamptz[]
    )`;
};

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
  await insertBookings(client, data.bookings);
  // `setval` is not transactional: the counter moves even if a surrounding transaction rolls back.
  await client.$queryRaw`SELECT setval('entity_seq', ${data.sequence}::bigint)`;
};
