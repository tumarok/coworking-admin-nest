import { Injectable } from '@nestjs/common';
import { OCCUPYING_STATUSES } from '../../common/bookings/occupying.js';
import { pageOffset } from '../../common/pagination/page.js';
import type {
  Booking,
  BookingConflict,
  BookingStatus,
  LocationStatus,
  Member,
  Room,
} from '../../contract/index.js';
import { nextEntityId } from '../../database/entity-id.js';
import { type DbClient, PrismaService } from '../../database/prisma.service.js';
import { allOf, containsAny } from '../../database/sql-filters.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { BookingListParams } from './bookings.types.js';
import type { Hours } from './domain/rules.js';

const DAY = 24 * 3_600_000;

// PostgreSQL has no year 0 and the driver writes years past 9999 in a form it rejects, so the
// bounds of a day filter stay within the years that every booking date can have.
const FIRST_INSTANT = Date.parse('0001-01-01T00:00:00.000Z');
const LAST_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');

/** The start of a UTC day (`YYYY-MM-DD`) or of a later one, as a bound clamped to the years the database takes. */
const dayStart = (day: string, days = 0): Date =>
  new Date(
    Math.min(
      Math.max(Date.parse(`${day}T00:00:00.000Z`) + days * DAY, FIRST_INSTANT),
      LAST_INSTANT,
    ),
  );

/** A timestamp as the API writes it, whatever the time zone of the session. */
const iso = (column: string) =>
  Prisma.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

// The names of a booking come from the room, the location and the member as they are now. A
// deleted one shows as a dash, but the booking stays and the room still names its real location.
const ROOM_NAME = Prisma.sql`CASE WHEN r.deleted_at IS NULL THEN r.name ELSE '—' END`;
const LOCATION_NAME = Prisma.sql`CASE WHEN r.deleted_at IS NULL AND l.deleted_at IS NULL THEN l.name ELSE '—' END`;
const MEMBER_NAME = Prisma.sql`CASE WHEN m.deleted_at IS NULL THEN m.first_name || ' ' || m.last_name ELSE '—' END`;

const COLUMNS = Prisma.sql`
  b.id, b.room_id AS "roomId", ${ROOM_NAME} AS "roomName", r.location_id AS "locationId",
  ${LOCATION_NAME} AS "locationName", b.member_id AS "memberId", ${MEMBER_NAME} AS "memberName",
  ${iso('b.starts_at')} AS "startsAt", ${iso('b.ends_at')} AS "endsAt", b.attendees, b.status,
  b.notes, b.total_price AS "totalPrice", ${iso('b.created_at')} AS "createdAt"`;
const FROM = Prisma.sql`bookings b
  JOIN rooms r ON r.id = b.room_id
  JOIN locations l ON l.id = r.location_id
  JOIN members m ON m.id = b.member_id`;

const findBooking = async (client: DbClient, id: string): Promise<Booking | undefined> => {
  const rows = await client.$queryRaw<Booking[]>`SELECT ${COLUMNS} FROM ${FROM} WHERE b.id = ${id}`;
  return rows.at(0);
};

/** True for the error of a write that broke the rule against overlapping bookings (SQLSTATE 23P01). */
const isExclusionViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  JSON.stringify(error.meta ?? {}).includes('23P01');

const findConflicts = async (
  client: DbClient,
  roomId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId?: string,
): Promise<BookingConflict[]> => {
  const rows = await client.booking.findMany({
    where: {
      roomId,
      status: { in: [...OCCUPYING_STATUSES] },
      // Intervals that only touch do not overlap.
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, startsAt: true, endsAt: true },
    orderBy: { seq: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
};

/** A room with the opening hours of its location, as a booking needs them; `location` is null when it is gone. */
export interface RoomFacts extends Pick<Room, 'status' | 'capacity' | 'hourlyRate'> {
  location: (Hours & { status: LocationStatus }) | null;
}

/** What the room query returns: the columns of the location are null when it is gone. */
interface RoomRow extends Pick<Room, 'status' | 'capacity' | 'hourlyRate'> {
  locationStatus: LocationStatus | null;
  timezone: string | null;
  opensAt: string | null;
  closesAt: string | null;
}

/** The fields a booking is written with. */
export interface BookingRow {
  roomId: string;
  memberId: string;
  startsAt: Date;
  endsAt: Date;
  attendees: number;
  notes: string | null;
  totalPrice: number;
}

/** The queries of one write transaction; `BookingsRepository.transaction` hands it out. */
export class BookingStore {
  constructor(private readonly tx: DbClient) {}

  /**
   * Locks a room that still exists until the transaction ends, and reads what a booking needs to
   * know of it and its location. The lock is `FOR UPDATE`, not `FOR SHARE`: it keeps the room from
   * being deleted and also queues the writes of one room, so the one that comes second sees the
   * booking of the first in its overlap check, answers 409 with the real `conflicts` and takes no
   * id. The exclusion constraint stays as the backstop for a write that does not come this way.
   */
  async lockRoom(id: string): Promise<RoomFacts | undefined> {
    const rows = await this.tx.$queryRaw<RoomRow[]>`
      SELECT r.status, r.capacity, r.hourly_rate AS "hourlyRate", l.status AS "locationStatus",
        l.timezone, l.opens_at AS "opensAt", l.closes_at AS "closesAt"
      FROM rooms r LEFT JOIN locations l ON l.id = r.location_id AND l.deleted_at IS NULL
      WHERE r.id = ${id} AND r.deleted_at IS NULL
      FOR UPDATE OF r`;
    const row = rows.at(0);
    if (!row) return undefined;
    const { status, capacity, hourlyRate, locationStatus, timezone, opensAt, closesAt } = row;
    const location =
      locationStatus && timezone && opensAt && closesAt
        ? { status: locationStatus, timezone, opensAt, closesAt }
        : null;
    return { status, capacity, hourlyRate, location };
  }

  /** Locks a member that still exists against deletion until the transaction ends. */
  async lockMember(id: string): Promise<Pick<Member, 'status'> | undefined> {
    const rows = await this.tx.$queryRaw<Pick<Member, 'status'>[]>`
      SELECT status FROM members WHERE id = ${id} AND deleted_at IS NULL FOR SHARE`;
    return rows.at(0);
  }

  /** Locks a booking, so that nothing else changes its status or its fields meanwhile. */
  async lockBooking(id: string): Promise<BookingStatus | undefined> {
    const rows = await this.tx.$queryRaw<{ status: BookingStatus }[]>`
      SELECT status FROM bookings WHERE id = ${id} FOR UPDATE`;
    return rows.at(0)?.status;
  }

  /**
   * Locks the bookings that exist among `ids` and returns their statuses. The rows are locked in
   * the order they were made, whatever the order of the request, so that two bulk requests that
   * share bookings queue behind each other instead of waiting for each other.
   */
  async lockBookings(ids: readonly string[]): Promise<Map<string, BookingStatus>> {
    const rows = await this.tx.$queryRaw<{ id: string; status: BookingStatus }[]>`
      SELECT id, status FROM bookings WHERE id IN (${Prisma.join(ids)}) ORDER BY seq FOR UPDATE`;
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  /** The bookings that keep a room occupied during the interval, in the order they were made. */
  conflicts(
    roomId: string,
    startsAt: Date,
    endsAt: Date,
    exceptId?: string,
  ): Promise<BookingConflict[]> {
    return findConflicts(this.tx, roomId, startsAt, endsAt, exceptId);
  }

  async insert(row: BookingRow, createdAt: Date): Promise<string> {
    const { id, seq } = await nextEntityId(this.tx, 'bk');
    await this.tx.booking.create({ data: { id, seq, status: 'pending', ...row, createdAt } });
    return id;
  }

  async update(id: string, row: BookingRow): Promise<void> {
    await this.tx.booking.update({ where: { id }, data: row });
  }

  /** Moves locked bookings to a status. */
  async setStatus(ids: readonly string[], status: BookingStatus): Promise<void> {
    await this.tx.booking.updateMany({ where: { id: { in: [...ids] } }, data: { status } });
  }

  /** A booking read back inside the transaction that wrote it, where it cannot be missing. */
  async reread(id: string): Promise<Booking> {
    const booking = await findBooking(this.tx, id);
    if (!booking) throw new Error(`Booking ${id} vanished inside its own transaction`);
    return booking;
  }
}

@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the bookings matching the filters, latest start first, and the number of all matches. */
  async list(params: BookingListParams): Promise<{ items: Booking[]; total: number }> {
    const { q, from, to, status, locationId, roomId, memberId, limit } = params;
    // Both days are included and a day is a UTC day; only the start of a booking counts.
    const where = allOf([
      ...(q ? [containsAny(q, [ROOM_NAME, LOCATION_NAME, MEMBER_NAME])] : []),
      ...(from ? [Prisma.sql`b.starts_at >= ${dayStart(from)}`] : []),
      ...(to ? [Prisma.sql`b.starts_at < ${dayStart(to, 1)}`] : []),
      ...(status ? [Prisma.sql`b.status = ${status}::booking_status`] : []),
      ...(locationId ? [Prisma.sql`r.location_id = ${locationId}`] : []),
      ...(roomId ? [Prisma.sql`b.room_id = ${roomId}`] : []),
      ...(memberId ? [Prisma.sql`b.member_id = ${memberId}`] : []),
    ]);

    // One snapshot for both, so the total always matches the rows.
    const [items, counts] = await this.prisma.client.$transaction(
      [
        this.prisma.client.$queryRaw<Booking[]>`
          SELECT ${COLUMNS} FROM ${FROM} WHERE ${where}
          ORDER BY b.starts_at DESC, b.seq LIMIT ${limit} OFFSET ${pageOffset(params)}`,
        this.prisma.client.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS total FROM ${FROM} WHERE ${where}`,
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total: counts.at(0)?.total ?? 0 };
  }

  find(id: string): Promise<Booking | undefined> {
    return findBooking(this.prisma.client, id);
  }

  conflicts(
    roomId: string,
    startsAt: Date,
    endsAt: Date,
    exceptId?: string,
  ): Promise<BookingConflict[]> {
    return findConflicts(this.prisma.client, roomId, startsAt, endsAt, exceptId);
  }

  /** Runs `work` in a transaction, for a write that cannot make two bookings overlap. */
  inTransaction<T>(work: (store: BookingStore) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction((tx) => work(new BookingStore(tx)));
  }

  /**
   * Runs `work` in a transaction. `'overlap'` when the database refused a write because the room
   * is occupied at that time: the check in `work` cannot see a booking that another transaction
   * has not committed yet, so the exclusion constraint decides between two requests that race.
   */
  async transaction<T>(work: (store: BookingStore) => Promise<T>): Promise<T | 'overlap'> {
    try {
      return await this.inTransaction(work);
    } catch (error) {
      if (isExclusionViolation(error)) return 'overlap';
      throw error;
    }
  }
}
