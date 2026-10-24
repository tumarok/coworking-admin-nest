import { Prisma } from '../generated/prisma/client.js';

/** A timestamp as the API writes it, whatever the time zone of the session. */
const iso = (column: string) =>
  Prisma.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

// The names of a booking come from the room, the location and the member as they are now. A
// deleted one shows as a dash, but the booking stays and the room still names its real location.
export const ROOM_NAME = Prisma.sql`CASE WHEN r.deleted_at IS NULL THEN r.name ELSE '—' END`;
export const LOCATION_NAME = Prisma.sql`CASE WHEN r.deleted_at IS NULL AND l.deleted_at IS NULL THEN l.name ELSE '—' END`;
export const MEMBER_NAME = Prisma.sql`CASE WHEN m.deleted_at IS NULL THEN m.first_name || ' ' || m.last_name ELSE '—' END`;

/** The columns of a `Booking`, to select from `BOOKING_FROM` (aliases `b`, `r`, `l`, `m`). */
export const BOOKING_COLUMNS = Prisma.sql`
  b.id, b.room_id AS "roomId", ${ROOM_NAME} AS "roomName", r.location_id AS "locationId",
  ${LOCATION_NAME} AS "locationName", b.member_id AS "memberId", ${MEMBER_NAME} AS "memberName",
  ${iso('b.starts_at')} AS "startsAt", ${iso('b.ends_at')} AS "endsAt", b.attendees, b.status,
  b.notes, b.total_price AS "totalPrice", ${iso('b.created_at')} AS "createdAt"`;
export const BOOKING_FROM = Prisma.sql`bookings b
  JOIN rooms r ON r.id = b.room_id
  JOIN locations l ON l.id = r.location_id
  JOIN members m ON m.id = b.member_id`;
