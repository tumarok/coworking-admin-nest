const DAY = 24 * 3_600_000;

// PostgreSQL has no year 0 and the driver writes years past 9999 in a form it rejects, so the
// bounds of a day filter stay within the years that every booking date can have.
const FIRST_INSTANT = Date.parse('0001-01-01T00:00:00.000Z');
const LAST_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');

/** The start of a UTC day (`YYYY-MM-DD`) or of a later one, as a bound clamped to the years the database takes. */
export const dayStart = (day: string, days = 0): Date =>
  new Date(
    Math.min(
      Math.max(Date.parse(`${day}T00:00:00.000Z`) + days * DAY, FIRST_INSTANT),
      LAST_INSTANT,
    ),
  );

/** The start of the UTC month a day (`YYYY-MM-DD`) is in, or of a later one, clamped like `dayStart`. */
export const monthStart = (day: string, months = 0): Date => {
  const start = new Date(`${day.slice(0, 7)}-01T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() + months);
  return new Date(Math.min(Math.max(start.getTime(), FIRST_INSTANT), LAST_INSTANT));
};
