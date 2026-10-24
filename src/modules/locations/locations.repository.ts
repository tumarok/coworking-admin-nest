import { Injectable } from '@nestjs/common';
import { pageOffset } from '../../common/pagination/page.js';
import { type Location, type LocationInput, timezoneSchema } from '../../contract/index.js';
import { nextEntityId } from '../../database/entity-id.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { allOf, containsAny } from '../../database/sql-filters.js';
import type { LocationListParams } from './locations.types.js';

interface LocationRow {
  id: string;
  name: string;
  city: string;
  address: string;
  timezone: string;
  opensAt: string;
  closesAt: string;
  status: Location['status'];
  roomCount: number;
}

// The columns of a `Location`, `roomCount` included: the rooms of the location that still exist.
const COLUMNS = Prisma.sql`
  l.id, l.name, l.city, l.address, l.timezone,
  l.opens_at AS "opensAt", l.closes_at AS "closesAt", l.status,
  (SELECT count(*)::int FROM rooms r WHERE r.location_id = l.id AND r.deleted_at IS NULL) AS "roomCount"`;

const toLocation = (row: LocationRow): Location => ({
  ...row,
  timezone: timezoneSchema.parse(row.timezone),
});

/** What became of a delete request. */
export type DeleteOutcome = 'deleted' | 'not-found' | 'has-rooms';

@Injectable()
export class LocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the locations matching the filters, by name, and the number of all matches. */
  async list(params: LocationListParams): Promise<{ items: Location[]; total: number }> {
    const { q, city, status, limit } = params;
    const where = allOf([
      Prisma.sql`l.deleted_at IS NULL`,
      ...(q
        ? [containsAny(q, [Prisma.raw('l.name'), Prisma.raw('l.city'), Prisma.raw('l.address')])]
        : []),
      ...(city ? [Prisma.sql`lower(l.city) = lower(${city})`] : []),
      ...(status ? [Prisma.sql`l.status = ${status}::location_status`] : []),
    ]);

    // One snapshot for both, so the total always matches the rows.
    const [rows, counts] = await this.prisma.client.$transaction(
      [
        this.prisma.client.$queryRaw<LocationRow[]>`
          SELECT ${COLUMNS} FROM locations l WHERE ${where}
          ORDER BY l.name, l.seq LIMIT ${limit} OFFSET ${pageOffset(params)}`,
        this.prisma.client.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS total FROM locations l WHERE ${where}`,
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items: rows.map(toLocation), total: counts.at(0)?.total ?? 0 };
  }

  async find(id: string): Promise<Location | undefined> {
    const rows = await this.prisma.client.$queryRaw<LocationRow[]>`
      SELECT ${COLUMNS} FROM locations l WHERE l.id = ${id} AND l.deleted_at IS NULL`;
    const row = rows.at(0);
    return row && toLocation(row);
  }

  async create(input: LocationInput): Promise<Location> {
    const { id, seq } = await nextEntityId(this.prisma.client, 'loc');
    await this.prisma.client.location.create({ data: { id, seq, ...input } });
    return { id, ...input, roomCount: 0 };
  }

  /** Replaces the fields of a location that still exists; `undefined` when it does not. */
  async update(id: string, input: LocationInput): Promise<Location | undefined> {
    const { count } = await this.prisma.client.location.updateMany({
      where: { id, deletedAt: null },
      data: input,
    });
    return count === 0 ? undefined : this.find(id);
  }

  /**
   * Soft-deletes a location that has no rooms. The row is locked first, so a room added at the
   * same moment (its foreign key takes a share lock on the location) either is counted here or
   * waits for the delete.
   */
  softDelete(id: string, deletedAt: Date): Promise<DeleteOutcome> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM locations WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) return 'not-found';

      const rooms = await tx.room.count({ where: { locationId: id, deletedAt: null } });
      if (rooms > 0) return 'has-rooms';

      await tx.location.update({ where: { id }, data: { deletedAt } });
      return 'deleted';
    });
  }
}
