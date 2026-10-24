import { Injectable } from '@nestjs/common';
import { OCCUPYING_STATUSES } from '../../common/bookings/occupying.js';
import { pageOffset } from '../../common/pagination/page.js';
import type { Room, RoomInput } from '../../contract/index.js';
import { nextEntityId } from '../../database/entity-id.js';
import { PrismaService, type DbClient } from '../../database/prisma.service.js';
import { allOf, containsAny } from '../../database/sql-filters.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { RoomListParams } from './rooms.types.js';

// The columns of a `Room`. A location that is gone shows as a dash, like the mock does.
const LOCATION_NAME = Prisma.sql`COALESCE(l.name, '—')`;
const COLUMNS = Prisma.sql`
  r.id, r.location_id AS "locationId", ${LOCATION_NAME} AS "locationName", r.name, r.type,
  r.capacity, r.hourly_rate AS "hourlyRate", r.amenities::text[] AS amenities, r.status`;
const FROM = Prisma.sql`rooms r LEFT JOIN locations l ON l.id = r.location_id AND l.deleted_at IS NULL`;

/**
 * Locks a location that still exists against deletion until the transaction ends (`locations`
 * deletes under `FOR UPDATE`); false when it is missing or deleted.
 */
const lockLocation = async (tx: DbClient, id: string): Promise<boolean> => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM locations WHERE id = ${id} AND deleted_at IS NULL FOR SHARE`;
  return rows.length > 0;
};

/** What became of a delete request. */
export type DeleteOutcome = 'deleted' | 'not-found' | 'has-bookings';

@Injectable()
export class RoomsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the rooms matching the filters, by location name and name, and the number of all matches. */
  async list(params: RoomListParams): Promise<{ items: Room[]; total: number }> {
    const { q, locationId, type, status, minCapacity, limit } = params;
    const where = allOf([
      Prisma.sql`r.deleted_at IS NULL`,
      ...(q ? [containsAny(q, [Prisma.raw('r.name'), LOCATION_NAME])] : []),
      ...(locationId ? [Prisma.sql`r.location_id = ${locationId}`] : []),
      ...(type ? [Prisma.sql`r.type = ${type}::room_type`] : []),
      ...(status ? [Prisma.sql`r.status = ${status}::room_status`] : []),
      ...(minCapacity ? [Prisma.sql`r.capacity >= ${minCapacity}`] : []),
    ]);

    // One snapshot for both, so the total always matches the rows.
    const [items, counts] = await this.prisma.client.$transaction(
      [
        this.prisma.client.$queryRaw<Room[]>`
          SELECT ${COLUMNS} FROM ${FROM} WHERE ${where}
          ORDER BY "locationName", r.name, r.seq LIMIT ${limit} OFFSET ${pageOffset(params)}`,
        this.prisma.client.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS total FROM ${FROM} WHERE ${where}`,
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total: counts.at(0)?.total ?? 0 };
  }

  async find(id: string, client: DbClient = this.prisma.client): Promise<Room | undefined> {
    const rows = await client.$queryRaw<Room[]>`
      SELECT ${COLUMNS} FROM ${FROM} WHERE r.id = ${id} AND r.deleted_at IS NULL`;
    return rows.at(0);
  }

  /** A room read back inside the transaction that wrote it, where it cannot be missing. */
  private async reread(tx: DbClient, id: string): Promise<Room> {
    const room = await this.find(id, tx);
    if (!room) throw new Error(`Room ${id} vanished inside its own transaction`);
    return room;
  }

  /** Creates a room; `'no-location'` when the location is missing or deleted. */
  create(input: RoomInput): Promise<Room | 'no-location'> {
    return this.prisma.client.$transaction(async (tx) => {
      if (!(await lockLocation(tx, input.locationId))) return 'no-location';

      const { id, seq } = await nextEntityId(tx, 'room');
      await tx.room.create({ data: { id, seq, ...input } });
      return this.reread(tx, id);
    });
  }

  /** Replaces the fields of a room that still exists, which may move it to another location. */
  update(id: string, input: RoomInput): Promise<Room | 'no-location' | 'not-found'> {
    return this.prisma.client.$transaction(async (tx) => {
      if (!(await lockLocation(tx, input.locationId))) return 'no-location';

      const { count } = await tx.room.updateMany({ where: { id, deletedAt: null }, data: input });
      return count === 0 ? 'not-found' : this.reread(tx, id);
    });
  }

  /**
   * Soft-deletes a room that has no upcoming booking. The row is locked first: a booking being
   * added at the same moment takes a share lock on the room (its foreign key does, and the
   * bookings module must lock it `FOR SHARE` and check `deleted_at` itself), so it either is
   * counted here or waits for the delete.
   */
  softDelete(id: string, now: Date): Promise<DeleteOutcome> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM rooms WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) return 'not-found';

      const upcoming = await tx.booking.count({
        where: { roomId: id, status: { in: [...OCCUPYING_STATUSES] }, endsAt: { gt: now } },
      });
      if (upcoming > 0) return 'has-bookings';

      await tx.room.update({ where: { id }, data: { deletedAt: now } });
      return 'deleted';
    });
  }
}
