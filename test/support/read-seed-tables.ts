import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * The tables read back from the database in the shape of the mock API's records (and of the golden
 * files): in insertion order, without `seq`, `deletedAt` and password hashes.
 */
export const readSeedTables = async (prisma: PrismaClient) => {
  const bySeq = { orderBy: { seq: 'asc' } } as const;
  const [users, locations, rooms, members, bookings] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { id: 'asc' },
    }),
    prisma.location.findMany(bySeq),
    prisma.room.findMany(bySeq),
    prisma.member.findMany(bySeq),
    prisma.booking.findMany(bySeq),
  ]);

  return {
    users,
    locations: locations.map(({ seq: _seq, deletedAt: _deletedAt, ...location }) => location),
    rooms: rooms.map(({ seq: _seq, deletedAt: _deletedAt, ...room }) => room),
    members: members.map(({ seq: _seq, deletedAt: _deletedAt, joinedAt, ...member }) => ({
      ...member,
      joinedAt: joinedAt.toISOString().slice(0, 10),
    })),
    bookings: bookings.map(({ seq: _seq, startsAt, endsAt, createdAt, ...booking }) => ({
      ...booking,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      createdAt: createdAt.toISOString(),
    })),
  };
};
