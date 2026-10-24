import { Injectable } from '@nestjs/common';
import { OCCUPYING_STATUSES } from '../../common/bookings/occupying.js';
import type { Booking, BookingStatus } from '../../contract/index.js';
import { BOOKING_COLUMNS, BOOKING_FROM } from '../../database/booking-view.js';
import { dayStart, monthStart } from '../../database/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { LiveBooking, OpenLocation, StatusCount } from './domain/formulas.js';

/** How many upcoming bookings the dashboard lists. */
const UPCOMING_LIMIT = 8;

/** The bookings whose hours count towards the occupancy of a day: those that hold the room, and the done ones. */
const HOURS_STATUSES: readonly BookingStatus[] = [...OCCUPYING_STATUSES, 'completed'];
/** The bookings that are still to come. */
const UPCOMING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed'];
/** The bookings whose price is revenue. */
const REVENUE_STATUSES: readonly BookingStatus[] = ['confirmed', 'checked_in', 'completed'];

const statusIn = (statuses: readonly BookingStatus[]) =>
  Prisma.sql`b.status IN (${Prisma.join(statuses.map((status) => Prisma.sql`${status}::booking_status`))})`;

/** What the queries of one dashboard return, as plain numbers and rows. */
export interface DashboardData {
  locations: OpenLocation[];
  live: LiveBooking[];
  statuses: StatusCount[];
  revenueMonth: number;
  activeMembers: number;
  upcoming: Booking[];
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the figures of a UTC day (`YYYY-MM-DD`) and of its month, and the bookings that start
   * from `now`. Deleted rooms, locations and members count as absent, but a booking stays in the
   * counts of its day whatever became of its room. One snapshot, so the figures agree.
   */
  async read(date: string, now: Date): Promise<DashboardData> {
    const from = dayStart(date);
    const to = dayStart(date, 1);
    const month = monthStart(date);
    const nextMonth = monthStart(date, 1);

    const [locations, live, statuses, revenue, members, upcoming] =
      await this.prisma.client.$transaction(
        [
          // The rooms that can be booked count towards the hours of an active location, in the
          // order the locations were made.
          this.prisma.client.$queryRaw<OpenLocation[]>`
            SELECT l.id AS "locationId", l.name AS "locationName", l.opens_at AS "opensAt",
              l.closes_at AS "closesAt", count(r.id)::int AS rooms
            FROM locations l
            LEFT JOIN rooms r ON r.location_id = l.id AND r.status = 'available' AND r.deleted_at IS NULL
            WHERE l.status = 'active' AND l.deleted_at IS NULL
            GROUP BY l.id ORDER BY l.seq`,
          // Milliseconds as a whole number, in the order the bookings were made, so that the sums
          // of the lengths come out as the mock adds them.
          this.prisma.client.$queryRaw<LiveBooking[]>`
            SELECT r.location_id AS "locationId",
              round(extract(epoch FROM (b.ends_at - b.starts_at)) * 1000)::float8 AS "durationMs"
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id AND r.status = 'available' AND r.deleted_at IS NULL
            JOIN locations l ON l.id = r.location_id AND l.status = 'active' AND l.deleted_at IS NULL
            WHERE b.starts_at >= ${from} AND b.starts_at < ${to}
              AND ${statusIn(HOURS_STATUSES)}
            ORDER BY b.seq`,
          this.prisma.client.$queryRaw<StatusCount[]>`
            SELECT status, count(*)::int AS count FROM bookings
            WHERE starts_at >= ${from} AND starts_at < ${to} GROUP BY status`,
          // A sum of whole cents, exact as a double far beyond any real month.
          this.prisma.client.$queryRaw<{ revenue: number }[]>`
            SELECT COALESCE(sum(b.total_price), 0)::float8 AS revenue FROM bookings b
            WHERE b.starts_at >= ${month} AND b.starts_at < ${nextMonth}
              AND ${statusIn(REVENUE_STATUSES)}`,
          this.prisma.client.$queryRaw<{ total: number }[]>`
            SELECT count(*)::int AS total FROM members WHERE status = 'active' AND deleted_at IS NULL`,
          this.prisma.client.$queryRaw<Booking[]>`
            SELECT ${BOOKING_COLUMNS} FROM ${BOOKING_FROM}
            WHERE b.starts_at >= ${now} AND ${statusIn(UPCOMING_STATUSES)}
            ORDER BY b.starts_at, b.seq LIMIT ${UPCOMING_LIMIT}`,
        ],
        { isolationLevel: 'RepeatableRead' },
      );

    return {
      locations,
      live,
      statuses,
      revenueMonth: revenue.at(0)?.revenue ?? 0,
      activeMembers: members.at(0)?.total ?? 0,
      upcoming,
    };
  }
}
