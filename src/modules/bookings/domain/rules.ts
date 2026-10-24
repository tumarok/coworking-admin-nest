import type {
  BookingInput,
  BookingStatus,
  LocationStatus,
  Member,
  Room,
} from '../../../contract/index.js';

const HOUR = 3_600_000;

/** Wall-clock "HH:mm" of an instant in the given IANA time zone. */
export const localTime = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

/** Calendar date "YYYY-MM-DD" of an instant in the given IANA time zone. */
export const localDate = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

/** The price in cents of the hours between two instants, rounded to a whole cent. */
export const bookingPrice = (hourlyRate: number, startsAt: Date, endsAt: Date): number =>
  Math.round((hourlyRate * (endsAt.getTime() - startsAt.getTime())) / HOUR);

/** The opening hours of a location, as "HH:mm" in its IANA time zone. */
export interface Hours {
  timezone: string;
  opensAt: string;
  closesAt: string;
}

/**
 * Whether a booking lies inside the opening hours of the location, in its time zone: on one local
 * day, from the opening time to the closing time (both included). Times compare as "HH:mm" text.
 */
export const withinOpeningHours = (location: Hours, startsAt: Date, endsAt: Date): boolean =>
  localDate(startsAt, location.timezone) === localDate(endsAt, location.timezone) &&
  localTime(startsAt, location.timezone) >= location.opensAt &&
  localTime(endsAt, location.timezone) <= location.closesAt;

/** Only a booking that has not started to be used can change its room, member or time. */
export const isEditable = (status: BookingStatus): boolean =>
  status === 'pending' || status === 'confirmed';

/** What the rules know about the entities of a booking; a member that does not exist is `undefined`. */
export interface BookableFacts {
  room: Pick<Room, 'status' | 'capacity'>;
  location: Hours & { status: LocationStatus };
  member: Pick<Member, 'status'> | undefined;
}

/**
 * The reasons a booking cannot be made, one message per form field, all together. Empty when the
 * room, the member and the time are fine; an overlap with another booking is checked after this.
 */
export const bookingProblems = (
  { room, location, member }: BookableFacts,
  { attendees }: Pick<BookingInput, 'attendees'>,
  startsAt: Date,
  endsAt: Date,
): Record<string, string> => {
  const problems: Record<string, string> = {};
  if (room.status !== 'available') problems.roomId = 'This room is not available for booking';
  else if (location.status !== 'active') problems.roomId = 'This location is closed';

  if (!member) problems.memberId = 'Member not found';
  else if (member.status !== 'active') problems.memberId = `Member is ${member.status}`;

  if (attendees > room.capacity) problems.attendees = `This room seats up to ${room.capacity}`;
  if (!withinOpeningHours(location, startsAt, endsAt)) {
    problems.startsAt = `Outside opening hours (${location.opensAt}–${location.closesAt} local time)`;
  }
  return problems;
};
