import { BOOKING_STATUSES, type BookingStatus, type Dashboard } from '../../../contract/index.js';

const HOUR = 3_600_000;

/** An active location with the number of its rooms that can be booked. */
export interface OpenLocation {
  locationId: string;
  locationName: string;
  opensAt: string;
  closesAt: string;
  rooms: number;
}

/** The length of a booking that counts towards the occupancy of a location. */
export interface LiveBooking {
  locationId: string;
  durationMs: number;
}

/** How many bookings of a day a status has. */
export interface StatusCount {
  status: BookingStatus;
  count: number;
}

/**
 * Hours and booked hours of every location, in the order given. The booked hours are the sum of
 * the lengths of its live bookings, rounded to half an hour; the available hours are the opening
 * hours of one room times the rooms, not rounded.
 */
export const occupancyOf = (
  locations: readonly OpenLocation[],
  live: readonly LiveBooking[],
): Dashboard['occupancy'] =>
  locations.map(({ locationId, locationName, opensAt, closesAt, rooms }) => {
    const [oh = 0, om = 0] = opensAt.split(':').map(Number);
    const [ch = 0, cm = 0] = closesAt.split(':').map(Number);
    const openHours = ch + cm / 60 - (oh + om / 60);
    const bookedHours = live
      .filter((booking) => booking.locationId === locationId)
      .reduce((sum, booking) => sum + booking.durationMs / HOUR, 0);
    return {
      locationId,
      locationName,
      bookedHours: Math.round(bookedHours * 2) / 2,
      availableHours: rooms * openHours,
    };
  });

/** Booked hours over available hours of all locations, at most 1 and 0 when nothing can be booked. */
export const occupancyRate = (occupancy: Dashboard['occupancy']): number => {
  const available = occupancy.reduce((sum, item) => sum + item.availableHours, 0);
  const booked = occupancy.reduce((sum, item) => sum + item.bookedHours, 0);
  return available > 0 ? Math.min(1, booked / available) : 0;
};

/** The count of every status, 0 for the ones that have no booking. */
export const byStatus = (counts: readonly StatusCount[]): Dashboard['byStatus'] => {
  const result = Object.fromEntries(BOOKING_STATUSES.map((status) => [status, 0])) as Record<
    BookingStatus,
    number
  >;
  for (const { status, count } of counts) result[status] += count;
  return result;
};

/** The bookings of a day that are not cancelled; a no-show still counts. */
export const bookingsToday = (statuses: Dashboard['byStatus']): number =>
  Object.entries(statuses).reduce(
    (sum, [status, count]) => (status === 'cancelled' ? sum : sum + count),
    0,
  );
