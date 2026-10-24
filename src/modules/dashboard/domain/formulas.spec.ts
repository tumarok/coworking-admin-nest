import { byStatus, bookingsToday, occupancyOf, occupancyRate } from './formulas.js';

const HOUR = 3_600_000;

const location = (id: string, rooms: number, opensAt = '08:00', closesAt = '20:00') => ({
  locationId: id,
  locationName: `Location ${id}`,
  opensAt,
  closesAt,
  rooms,
});

describe('occupancyOf', () => {
  it('gives every location its opening hours times its rooms, in the order given', () => {
    const result = occupancyOf([location('b', 2), location('a', 3, '07:30', '20:00')], []);

    expect(result).toEqual([
      { locationId: 'b', locationName: 'Location b', bookedHours: 0, availableHours: 24 },
      { locationId: 'a', locationName: 'Location a', bookedHours: 0, availableHours: 37.5 },
    ]);
  });

  it('does not round the available hours', () => {
    const [only] = occupancyOf([location('a', 3, '08:20', '19:50')], []);

    expect(only.availableHours).toBe(3 * (19 + 50 / 60 - (8 + 20 / 60)));
  });

  it('is 0 hours for a location without a room that can be booked', () => {
    expect(occupancyOf([location('a', 0)], [])[0].availableHours).toBe(0);
  });

  it('adds the lengths of the bookings of a location and rounds to half an hour', () => {
    const live = [
      { locationId: 'a', durationMs: 1.2 * HOUR },
      { locationId: 'a', durationMs: 1.2 * HOUR },
      { locationId: 'b', durationMs: HOUR },
    ];

    const [a, b] = occupancyOf([location('a', 1), location('b', 1)], live);

    expect(a.bookedHours).toBe(2.5);
    expect(b.bookedHours).toBe(1);
  });

  it.each([
    [0.24, 0],
    [0.25, 0.5],
    [0.74, 0.5],
    [0.75, 1],
    [1.5, 1.5],
  ])('rounds %s booked hours to %s', (hours, rounded) => {
    const [only] = occupancyOf([location('a', 1)], [{ locationId: 'a', durationMs: hours * HOUR }]);

    expect(only.bookedHours).toBe(rounded);
  });

  it('ignores bookings of a location that is not listed', () => {
    const [only] = occupancyOf([location('a', 1)], [{ locationId: 'z', durationMs: HOUR }]);

    expect(only.bookedHours).toBe(0);
  });
});

describe('occupancyRate', () => {
  it('is the booked hours over the available hours of all locations', () => {
    const rate = occupancyRate([
      { locationId: 'a', locationName: 'A', bookedHours: 3, availableHours: 12 },
      { locationId: 'b', locationName: 'B', bookedHours: 1, availableHours: 20 },
    ]);

    expect(rate).toBe(4 / 32);
  });

  it('is 0 when nothing can be booked', () => {
    expect(occupancyRate([])).toBe(0);
    expect(
      occupancyRate([{ locationId: 'a', locationName: 'A', bookedHours: 2, availableHours: 0 }]),
    ).toBe(0);
  });

  it('is at most 1', () => {
    expect(
      occupancyRate([{ locationId: 'a', locationName: 'A', bookedHours: 14, availableHours: 12 }]),
    ).toBe(1);
  });
});

describe('byStatus', () => {
  it('has every status, 0 where there is no booking', () => {
    expect(byStatus([])).toEqual({
      pending: 0,
      confirmed: 0,
      checked_in: 0,
      completed: 0,
      cancelled: 0,
      no_show: 0,
    });
  });

  it('puts the counts under their statuses', () => {
    expect(
      byStatus([
        { status: 'confirmed', count: 4 },
        { status: 'no_show', count: 1 },
      ]),
    ).toMatchObject({ confirmed: 4, no_show: 1, pending: 0 });
  });
});

describe('bookingsToday', () => {
  it('counts every status but cancelled, a no-show included', () => {
    expect(
      bookingsToday({
        pending: 1,
        confirmed: 2,
        checked_in: 3,
        completed: 4,
        cancelled: 50,
        no_show: 6,
      }),
    ).toBe(16);
  });
});
