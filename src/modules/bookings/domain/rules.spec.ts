import {
  bookingPrice,
  bookingProblems,
  isEditable,
  localDate,
  localTime,
  withinOpeningHours,
  type BookableFacts,
} from './rules.js';

const at = (iso: string) => new Date(iso);

const kyiv = { timezone: 'Europe/Kyiv', opensAt: '08:00', closesAt: '20:00' } as const;

describe('localTime and localDate', () => {
  it('read the wall clock of the time zone', () => {
    expect(localTime(at('2026-07-01T06:00:00Z'), 'Europe/Kyiv')).toBe('09:00');
    expect(localTime(at('2026-07-01T06:00:00Z'), 'Europe/Lisbon')).toBe('07:00');
    expect(localDate(at('2026-07-01T22:30:00Z'), 'Europe/Kyiv')).toBe('2026-07-02');
  });

  it('follow the change of the clocks', () => {
    // Kyiv moves from UTC+2 to UTC+3 on 2026-03-29 and back on 2026-10-25.
    expect(localTime(at('2026-03-28T10:00:00Z'), 'Europe/Kyiv')).toBe('12:00');
    expect(localTime(at('2026-03-29T10:00:00Z'), 'Europe/Kyiv')).toBe('13:00');
    expect(localTime(at('2026-10-24T10:00:00Z'), 'Europe/Kyiv')).toBe('13:00');
    expect(localTime(at('2026-10-25T10:00:00Z'), 'Europe/Kyiv')).toBe('12:00');
  });

  it('write midnight as 00:00', () => {
    expect(localTime(at('2026-01-10T22:00:00Z'), 'Europe/Kyiv')).toBe('00:00');
  });
});

describe('bookingPrice', () => {
  it('charges the hours at the hourly rate', () => {
    expect(bookingPrice(2500, at('2026-10-14T09:00:00Z'), at('2026-10-14T10:30:00Z'))).toBe(3750);
    expect(bookingPrice(2000, at('2026-10-14T09:00:00Z'), at('2026-10-14T10:00:00Z'))).toBe(2000);
  });

  it('rounds to a whole cent, halves up', () => {
    // 25 cents an hour for 90 minutes is 37.5 cents.
    expect(bookingPrice(25, at('2026-10-14T09:00:00Z'), at('2026-10-14T10:30:00Z'))).toBe(38);
    // 50 cents an hour for 45 minutes is 37.5 cents; 10 for 20 minutes is 3.33.
    expect(bookingPrice(50, at('2026-10-14T09:00:00Z'), at('2026-10-14T09:45:00Z'))).toBe(38);
    expect(bookingPrice(10, at('2026-10-14T09:00:00Z'), at('2026-10-14T09:20:00Z'))).toBe(3);
  });

  it('is free for a free room', () => {
    expect(bookingPrice(0, at('2026-10-14T09:00:00Z'), at('2026-10-14T17:00:00Z'))).toBe(0);
  });
});

describe('withinOpeningHours', () => {
  it('accepts a booking inside the hours, in the time zone of the location', () => {
    // 08:00-20:00 in Kyiv in summer is 05:00-17:00 UTC.
    expect(withinOpeningHours(kyiv, at('2026-07-01T06:00:00Z'), at('2026-07-01T08:00:00Z'))).toBe(
      true,
    );
  });

  it('includes both the opening and the closing time', () => {
    expect(withinOpeningHours(kyiv, at('2026-07-01T05:00:00Z'), at('2026-07-01T06:00:00Z'))).toBe(
      true,
    );
    expect(withinOpeningHours(kyiv, at('2026-07-01T16:00:00Z'), at('2026-07-01T17:00:00Z'))).toBe(
      true,
    );
  });

  it('refuses a start before opening or an end after closing', () => {
    expect(withinOpeningHours(kyiv, at('2026-07-01T04:59:00Z'), at('2026-07-01T06:00:00Z'))).toBe(
      false,
    );
    expect(withinOpeningHours(kyiv, at('2026-07-01T16:00:00Z'), at('2026-07-01T17:01:00Z'))).toBe(
      false,
    );
  });

  it('uses the offset of the day, so the same UTC hours differ across the seasons', () => {
    // 05:00-07:00 UTC is 08:00-10:00 in Kyiv in summer (inside) but 07:00-09:00 in winter (not).
    expect(withinOpeningHours(kyiv, at('2026-07-01T05:00:00Z'), at('2026-07-01T07:00:00Z'))).toBe(
      true,
    );
    expect(withinOpeningHours(kyiv, at('2026-01-10T05:00:00Z'), at('2026-01-10T07:00:00Z'))).toBe(
      false,
    );
  });

  it('refuses a booking that crosses local midnight, even one that ends exactly at it', () => {
    const night = { timezone: 'Europe/Kyiv', opensAt: '00:00', closesAt: '23:59' };

    expect(withinOpeningHours(night, at('2026-01-10T21:00:00Z'), at('2026-01-10T23:00:00Z'))).toBe(
      false,
    );
    expect(withinOpeningHours(night, at('2026-01-10T20:00:00Z'), at('2026-01-10T22:00:00Z'))).toBe(
      false,
    );
  });

  it('judges the local day of a booking that is a different day in UTC', () => {
    // 22:00-23:00 UTC in winter is 00:00-01:00 the next day in Kyiv: inside a 24-hour location.
    const allDay = { timezone: 'Europe/Kyiv', opensAt: '00:00', closesAt: '23:59' };

    expect(withinOpeningHours(allDay, at('2026-01-10T22:00:00Z'), at('2026-01-10T23:00:00Z'))).toBe(
      true,
    );
  });
});

describe('bookingProblems', () => {
  const facts = (change: Partial<BookableFacts> = {}): BookableFacts => ({
    room: { status: 'available', capacity: 6 },
    location: { status: 'active', ...kyiv },
    member: { status: 'active' },
    ...change,
  });
  const inside = [at('2026-07-01T06:00:00Z'), at('2026-07-01T08:00:00Z')] as const;

  it('finds nothing wrong with a booking that fits', () => {
    expect(bookingProblems(facts(), { attendees: 6 }, ...inside)).toEqual({});
  });

  it('reports a room that cannot be booked, then a closed location only when the room is fine', () => {
    expect(
      bookingProblems(
        facts({ room: { status: 'maintenance', capacity: 6 } }),
        { attendees: 1 },
        ...inside,
      ),
    ).toEqual({ roomId: 'This room is not available for booking' });
    expect(
      bookingProblems(
        facts({ location: { status: 'inactive', ...kyiv } }),
        { attendees: 1 },
        ...inside,
      ),
    ).toEqual({ roomId: 'This location is closed' });
    expect(
      bookingProblems(
        facts({
          room: { status: 'retired', capacity: 6 },
          location: { status: 'inactive', ...kyiv },
        }),
        { attendees: 1 },
        ...inside,
      ),
    ).toEqual({ roomId: 'This room is not available for booking' });
  });

  it('reports a missing member and a member who is not active', () => {
    expect(bookingProblems(facts({ member: undefined }), { attendees: 1 }, ...inside)).toEqual({
      memberId: 'Member not found',
    });
    expect(
      bookingProblems(facts({ member: { status: 'suspended' } }), { attendees: 1 }, ...inside),
    ).toEqual({ memberId: 'Member is suspended' });
  });

  it('reports more attendees than seats', () => {
    expect(bookingProblems(facts(), { attendees: 7 }, ...inside)).toEqual({
      attendees: 'This room seats up to 6',
    });
  });

  it('names the opening hours when the booking is outside them', () => {
    expect(
      bookingProblems(
        facts(),
        { attendees: 1 },
        at('2026-07-01T03:00:00Z'),
        at('2026-07-01T05:00:00Z'),
      ),
    ).toEqual({ startsAt: 'Outside opening hours (08:00–20:00 local time)' });
  });

  it('reports every problem together', () => {
    expect(
      bookingProblems(
        facts({
          room: { status: 'maintenance', capacity: 2 },
          member: { status: 'cancelled' },
        }),
        { attendees: 3 },
        at('2026-07-01T03:00:00Z'),
        at('2026-07-01T05:00:00Z'),
      ),
    ).toEqual({
      roomId: 'This room is not available for booking',
      memberId: 'Member is cancelled',
      attendees: 'This room seats up to 2',
      startsAt: 'Outside opening hours (08:00–20:00 local time)',
    });
  });
});

describe('isEditable', () => {
  it.each([
    ['pending', true],
    ['confirmed', true],
    ['checked_in', false],
    ['completed', false],
    ['cancelled', false],
    ['no_show', false],
  ] as const)('says %s is %s', (status, editable) => {
    expect(isEditable(status)).toBe(editable);
  });
});
