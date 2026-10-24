import { Clock } from '../src/common/clock/clock.js';
import { BOOKING_STATUSES, type BookingStatus, dashboardSchema } from '../src/contract/index.js';
import { nextEntityId } from '../src/database/entity-id.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { SEED_NOW } from './support/constants.js';
import { expectContract } from './support/expect-contract.js';
import type { FixedClock } from './support/fixed-clock.js';
import { loadDashboardGolden } from './support/golden.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

const BASE = '/api/v1/dashboard';
const HOUR = 3_600_000;

const golden = loadDashboardGolden();
const DAYS = Object.keys(golden.days);

describe('dashboard (seed data)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;

  const dashboard = (query = '') => api.http.get(`${BASE}${query}`).set(auth);

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
  });

  afterAll(async () => {
    await api.close();
  });

  it('answers 401 without a token', async () => {
    const { status, body } = await api.http.get(BASE);

    expect(status).toBe(401);
    expect(body).toEqual({ message: 'Authentication required' });
  });

  it.each(DAYS)('gives the answer of the mock for %s, number for number', async (date) => {
    const { status, body } = await dashboard(`?date=${date}`);

    expect(status).toBe(200);
    expect(expectContract(dashboardSchema, body)).toEqual(golden.days[date]);
  });

  it('shows the day of the clock when no date is asked for', async () => {
    const { status, body } = await dashboard();

    expect(status).toBe(200);
    expect(expectContract(dashboardSchema, body)).toEqual(golden.default);
    expect((body as { date: string }).date).toBe('2026-10-14');
  });

  it('treats an empty date as no date', async () => {
    const { status, body } = await dashboard('?date=');

    expect(status).toBe(200);
    expect(body).toEqual(golden.emptyDate);
  });

  it('keeps the last of a repeated date', async () => {
    const first = await dashboard('?date=2026-10-07&date=2026-10-21');
    const second = await dashboard('?date=2026-10-21&date=2026-10-07');

    expect(first.body).toEqual(golden.days['2026-10-21']);
    expect(second.body).toEqual(golden.days['2026-10-07']);
  });

  it('refuses a repeated date when the last of them is not one', async () => {
    const { status, body } = await dashboard('?date=2026-10-07&date=abc');

    expect(status).toBe(422);
    expect(body).toEqual({
      message: 'Validation failed',
      fieldErrors: { date: 'Invalid ISO date' },
    });
  });

  it('ignores keys it does not know', async () => {
    const { body } = await dashboard('?date=2026-10-07&page=3&q=x');

    expect(body).toEqual(golden.days['2026-10-07']);
  });

  it('answers a trailing slash', async () => {
    const { status, body } = await api.http.get(`${BASE}/`).set(auth);

    expect(status).toBe(200);
    expect(body).toEqual(golden.default);
  });

  it.each(Object.keys(golden.errors))('answers 422 for the date %s like the mock', async (date) => {
    const { status, body } = await dashboard(`?date=${encodeURIComponent(date)}`);

    expect({ status, body }).toEqual(golden.errors[date]);
  });

  it('has every status in the counts, whatever the day', async () => {
    for (const date of ['2026-10-14', '2027-03-01']) {
      const { body } = await dashboard(`?date=${date}`);

      expect(Object.keys((body as { byStatus: object }).byStatus).sort()).toEqual(
        [...BOOKING_STATUSES].sort(),
      );
    }
  });

  it('counts the bookings of a day in the statuses, and the day today without the cancelled', async () => {
    const { body } = await dashboard('?date=2026-10-14');
    const { byStatus, kpis } = expectContract(dashboardSchema, body);

    const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);

    expect(total).toBe(golden.days['2026-10-14'].kpis.bookingsToday + byStatus.cancelled);
    expect(kpis.bookingsToday).toBe(total - byStatus.cancelled);
  });

  it('lists the eight next pending or confirmed bookings from the clock, whatever the day', async () => {
    const { upcoming } = expectContract(
      dashboardSchema,
      (await dashboard('?date=2026-08-15')).body,
    );

    expect(upcoming).toHaveLength(8);
    expect(upcoming.every((b) => ['pending', 'confirmed'].includes(b.status))).toBe(true);
    expect(upcoming.every((b) => Date.parse(b.startsAt) >= SEED_NOW.getTime())).toBe(true);
    expect(upcoming.map((b) => b.startsAt)).toEqual(upcoming.map((b) => b.startsAt).sort());
    expect(upcoming).toEqual(golden.default.upcoming);
  });

  it('lists the active locations in the order they were made, the closed one not', async () => {
    const { occupancy } = expectContract(dashboardSchema, (await dashboard()).body);

    expect(occupancy.map((item) => item.locationId)).toEqual(['loc_1', 'loc_2', 'loc_3', 'loc_4']);
  });

  it.each(['0001-01-01', '0000-01-01', '9999-12-31'])(
    'answers the day %s, where the database has no dates to compare',
    async (date) => {
      const { status, body } = await dashboard(`?date=${date}`);

      expect(status).toBe(200);
      expect(expectContract(dashboardSchema, body)).toMatchObject({
        date,
        kpis: {
          bookingsToday: 0,
          revenueMonth: 0,
          activeMembers: golden.days['2026-10-14'].kpis.activeMembers,
        },
        byStatus: {
          pending: 0,
          confirmed: 0,
          checked_in: 0,
          completed: 0,
          cancelled: 0,
          no_show: 0,
        },
      });
    },
  );
});

describe('dashboard (changes)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let prisma: PrismaService;
  let clock: FixedClock;
  let counter = 0;

  const dashboard = async (date: string) => {
    const { status, body } = await api.http.get(`${BASE}?date=${date}`).set(auth);
    expect(status).toBe(200);
    return expectContract(dashboardSchema, body);
  };
  const created = async (path: string, input: object) => {
    const { status, body } = await api.http.post(path).set(auth).send(input);
    expect(status).toBe(201);
    return (body as { id: string }).id;
  };
  const patch = async (path: string, input: object) => {
    const { status } = await api.http.patch(path).set(auth).send(input);
    expect(status).toBe(200);
  };
  /** A location of its own that is open 08:00-20:00 in Kyiv, 05:00-17:00 UTC in summer. */
  const newLocation = (change: object = {}) =>
    created('/api/v1/locations', {
      name: `Dashboard Court ${++counter}`,
      city: 'Kyiv',
      address: '5 Sadova St',
      timezone: 'Europe/Kyiv',
      opensAt: '08:00',
      closesAt: '20:00',
      status: 'active',
      ...change,
    });
  const roomInput = (locationId: string, change: object = {}) => ({
    locationId,
    name: `Room ${++counter}`,
    type: 'meeting_room',
    capacity: 6,
    hourlyRate: 2500,
    amenities: [],
    status: 'available',
    ...change,
  });
  const newRoom = (locationId: string, change: object = {}) =>
    created('/api/v1/rooms', roomInput(locationId, change));
  const memberInput = (change: object = {}) => ({
    firstName: 'Dana',
    lastName: 'Testova',
    email: `dana${++counter}@example.com`,
    phone: '+380 50 123 45 67',
    company: null,
    plan: 'flex',
    status: 'active',
    ...change,
  });
  const newMember = (change: object = {}) => created('/api/v1/members', memberInput(change));
  const bookingInput = (
    roomId: string,
    memberId: string,
    day: string,
    from: string,
    to: string,
  ) => ({
    roomId,
    memberId,
    startsAt: `${day}T${from}:00.000Z`,
    endsAt: `${day}T${to}:00.000Z`,
    attendees: 2,
    notes: null,
  });
  const newBooking = (roomId: string, memberId: string, day: string, from: string, to: string) =>
    created('/api/v1/bookings', bookingInput(roomId, memberId, day, from, to));
  const setStatus = (id: string, status: BookingStatus) =>
    prisma.client.booking.update({ where: { id }, data: { status } });
  /** A booking written straight into the table, at instants the opening hours would not allow. */
  const insertBooking = async (
    roomId: string,
    memberId: string,
    startsAt: string,
    endsAt: string,
    status: BookingStatus,
    totalPrice: number,
  ) => {
    const { id, seq } = await nextEntityId(prisma.client, 'bk');
    await prisma.client.booking.create({
      data: {
        id,
        seq,
        roomId,
        memberId,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        attendees: 1,
        status,
        notes: null,
        totalPrice,
        createdAt: SEED_NOW,
      },
    });
    return id;
  };
  /** Moves the clock and signs in again, because the token is dated by it. */
  const moveClockTo = async (instant: string) => {
    clock.set(new Date(instant));
    auth = bearer(await signIn(api));
  };
  const of = <T extends { locationId: string }>(occupancy: T[], locationId: string) =>
    occupancy.find((item) => item.locationId === locationId);

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
    prisma = api.app.get(PrismaService);
    clock = api.app.get<FixedClock>(Clock);
  });

  afterAll(async () => {
    await api.close();
  });

  afterEach(async () => {
    await moveClockTo(SEED_NOW.toISOString());
  });

  it('adds a new location with its rooms to the hours of the day', async () => {
    const before = await dashboard('2030-06-03');
    const locationId = await newLocation();
    await newRoom(locationId);
    await newRoom(locationId, { status: 'maintenance' });

    const after = await dashboard('2030-06-03');

    expect(of(after.occupancy, locationId)).toMatchObject({ bookedHours: 0, availableHours: 12 });
    expect(after.occupancy.slice(0, before.occupancy.length)).toEqual(before.occupancy);
    expect(after.occupancy).toHaveLength(before.occupancy.length + 1);
  });

  it('moves the figures of the day with a booking and its statuses', async () => {
    const day = '2030-08-05';
    const before = await dashboard(day);
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const memberId = await newMember();
    const hours = ['05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00'];
    for (const [index, status] of BOOKING_STATUSES.entries()) {
      const id = await newBooking(roomId, memberId, day, hours[index], hours[index + 1]);
      if (status !== 'pending') await setStatus(id, status);
    }

    const result = await dashboard(day);

    expect(result.byStatus).toEqual({
      pending: 1,
      confirmed: 1,
      checked_in: 1,
      completed: 1,
      cancelled: 1,
      no_show: 1,
    });
    // Every status but cancelled counts for the day, a no-show too.
    expect(result.kpis.bookingsToday).toBe(5);
    // The booked hours are those of a pending, confirmed, checked-in and completed booking.
    expect(of(result.occupancy, locationId)).toMatchObject({ bookedHours: 4, availableHours: 12 });
    // The rate is over the hours of all the locations: those the day had before, and this one.
    const booked = result.occupancy.reduce((sum, item) => sum + item.bookedHours, 0);
    const available = result.occupancy.reduce((sum, item) => sum + item.availableHours, 0);
    const availableBefore = before.occupancy.reduce((sum, item) => sum + item.availableHours, 0);
    expect(booked).toBe(4);
    expect(available).toBe(availableBefore + 12);
    expect(result.kpis.occupancyRate).toBe(booked / available);
    // The month pays for a confirmed, checked-in and completed booking, an hour of 2500 each.
    expect(result.kpis.revenueMonth).toBe(3 * 2500);
  });

  it('leaves the booking of a pending status out of the revenue and a cancelled one out of the hours', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const memberId = await newMember();
    const day = '2030-09-10';
    const id = await newBooking(roomId, memberId, day, '09:00', '10:30');

    const pending = await dashboard(day);
    expect(pending.kpis.revenueMonth).toBe(0);
    expect(of(pending.occupancy, locationId)?.bookedHours).toBe(1.5);

    await setStatus(id, 'confirmed');
    expect((await dashboard(day)).kpis.revenueMonth).toBe(3750);

    await setStatus(id, 'cancelled');
    const cancelled = await dashboard(day);
    expect(cancelled.kpis).toMatchObject({ revenueMonth: 0, bookingsToday: 0 });
    expect(cancelled.byStatus.cancelled).toBe(1);
    expect(of(cancelled.occupancy, locationId)?.bookedHours).toBe(0);
  });

  it('rounds the booked hours of a location to half an hour', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const memberId = await newMember();
    const day = '2030-10-07';
    await newBooking(roomId, memberId, day, '09:00', '09:20');
    await newBooking(roomId, memberId, day, '10:00', '10:20');
    await newBooking(roomId, memberId, day, '11:00', '11:20');

    // Three bookings of 20 minutes are 60 minutes, which is one hour.
    expect(of((await dashboard(day)).occupancy, locationId)?.bookedHours).toBe(1);
  });

  it('counts a booking to the month and the day it starts in, to the millisecond', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const otherId = await newRoom(locationId);
    const memberId = await newMember();
    await insertBooking(
      roomId,
      memberId,
      '2031-01-31T23:59:59.999Z',
      '2031-02-01T00:30:00.000Z',
      'confirmed',
      700,
    );
    await insertBooking(
      otherId,
      memberId,
      '2031-02-01T00:00:00.000Z',
      '2031-02-01T01:00:00.000Z',
      'confirmed',
      5000,
    );

    const january = await dashboard('2031-01-31');
    const february = await dashboard('2031-02-01');
    const mid = await dashboard('2031-01-15');

    expect(january.kpis).toMatchObject({ bookingsToday: 1, revenueMonth: 700 });
    expect(february.kpis).toMatchObject({ bookingsToday: 1, revenueMonth: 5000 });
    expect(mid.kpis).toMatchObject({ bookingsToday: 0, revenueMonth: 700 });
    expect(of(january.occupancy, locationId)?.bookedHours).toBe(0.5);
  });

  it('counts the active members only, and loses a member that is deleted or suspended', async () => {
    const before = (await dashboard('2030-11-01')).kpis.activeMembers;
    const first = await newMember();
    const second = await newMember();
    const third = await newMember();
    expect((await dashboard('2030-11-01')).kpis.activeMembers).toBe(before + 3);

    await patch(`/api/v1/members/${first}`, memberInput({ status: 'suspended' }));
    expect((await dashboard('2030-11-01')).kpis.activeMembers).toBe(before + 2);

    await patch(`/api/v1/members/${second}`, memberInput({ status: 'cancelled' }));
    expect((await dashboard('2030-11-01')).kpis.activeMembers).toBe(before + 1);

    expect((await api.http.delete(`/api/v1/members/${third}`).set(auth)).status).toBe(204);
    expect((await dashboard('2030-11-01')).kpis.activeMembers).toBe(before);
  });

  it('drops a closed location from the hours but keeps its bookings in the counts', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const memberId = await newMember();
    const day = '2030-12-04';
    await newBooking(roomId, memberId, day, '09:00', '11:00');
    expect(of((await dashboard(day)).occupancy, locationId)).toBeDefined();

    await patch(`/api/v1/locations/${locationId}`, {
      name: 'Closed Court',
      city: 'Kyiv',
      address: '5 Sadova St',
      timezone: 'Europe/Kyiv',
      opensAt: '08:00',
      closesAt: '20:00',
      status: 'inactive',
    });

    const result = await dashboard(day);
    expect(of(result.occupancy, locationId)).toBeUndefined();
    expect(result.kpis.bookingsToday).toBe(1);
    expect(result.byStatus.pending).toBe(1);
  });

  it('takes a room out of the hours when it is under maintenance, not out of the counts', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const otherId = await newRoom(locationId);
    const memberId = await newMember();
    const day = '2031-03-04';
    await newBooking(roomId, memberId, day, '09:00', '11:00');
    await newBooking(otherId, memberId, day, '09:00', '10:00');
    expect(of((await dashboard(day)).occupancy, locationId)).toMatchObject({
      bookedHours: 3,
      availableHours: 24,
    });

    await patch(`/api/v1/rooms/${roomId}`, roomInput(locationId, { status: 'maintenance' }));

    const result = await dashboard(day);
    expect(of(result.occupancy, locationId)).toMatchObject({ bookedHours: 1, availableHours: 12 });
    expect(result.kpis.bookingsToday).toBe(2);
  });

  it('keeps the bookings of a deleted room in the counts and the revenue, out of the hours', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const memberId = await newMember();
    const day = '2031-04-08';
    const id = await newBooking(roomId, memberId, day, '09:00', '11:00');
    await setStatus(id, 'completed');
    expect((await api.http.delete(`/api/v1/rooms/${roomId}`).set(auth)).status).toBe(204);

    const result = await dashboard(day);

    expect(of(result.occupancy, locationId)).toMatchObject({ bookedHours: 0, availableHours: 0 });
    expect(result.byStatus.completed).toBe(1);
    expect(result.kpis).toMatchObject({ bookingsToday: 1, revenueMonth: 5000 });
  });

  it('keeps the bookings of a deleted member in the counts', async () => {
    const locationId = await newLocation();
    const roomId = await newRoom(locationId);
    const memberId = await newMember();
    const day = '2031-06-10';
    const id = await newBooking(roomId, memberId, day, '09:00', '10:00');
    await setStatus(id, 'completed');
    expect((await api.http.delete(`/api/v1/members/${memberId}`).set(auth)).status).toBe(204);

    const result = await dashboard(day);

    expect(result.byStatus.completed).toBe(1);
    expect(of(result.occupancy, locationId)?.bookedHours).toBe(1);
  });

  it('does not list a location that was deleted', async () => {
    const locationId = await newLocation();

    expect((await api.http.delete(`/api/v1/locations/${locationId}`).set(auth)).status).toBe(204);

    expect(of((await dashboard('2030-06-03')).occupancy, locationId)).toBeUndefined();
  });
});

describe('dashboard (upcoming bookings)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let prisma: PrismaService;
  let clock: FixedClock;
  let roomIds: string[];
  let memberId: string;

  const created = async (path: string, input: object) => {
    const { status, body } = await api.http.post(path).set(auth).send(input);
    expect(status).toBe(201);
    return (body as { id: string }).id;
  };
  const upcoming = async () => {
    const { status, body } = await api.http.get(`${BASE}?date=2032-01-01`).set(auth);
    expect(status).toBe(200);
    return expectContract(dashboardSchema, body).upcoming;
  };
  const book = (roomId: string, day: string, from: string, to: string) =>
    created('/api/v1/bookings', {
      roomId,
      memberId,
      startsAt: `${day}T${from}:00.000Z`,
      endsAt: `${day}T${to}:00.000Z`,
      attendees: 1,
      notes: null,
    });

  // Each test has its own database, so the upcoming bookings of one never reach another.
  beforeEach(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
    prisma = api.app.get(PrismaService);
    clock = api.app.get<FixedClock>(Clock);
    const locationId = await created('/api/v1/locations', {
      name: 'Upcoming Court',
      city: 'Kyiv',
      address: '5 Sadova St',
      timezone: 'Europe/Kyiv',
      opensAt: '08:00',
      closesAt: '20:00',
      status: 'active',
    });
    roomIds = [];
    for (const name of ['One', 'Two', 'Three']) {
      roomIds.push(
        await created('/api/v1/rooms', {
          locationId,
          name,
          type: 'meeting_room',
          capacity: 6,
          hourlyRate: 2500,
          amenities: [],
          status: 'available',
        }),
      );
    }
    memberId = await created('/api/v1/members', {
      firstName: 'Dana',
      lastName: 'Testova',
      email: 'upcoming@example.com',
      phone: '+380 50 123 45 67',
      company: null,
      plan: 'flex',
      status: 'active',
    });
    // Later than every seeded booking, so that these are all the upcoming ones.
    clock.set(new Date('2032-01-01T00:00:00.000Z'));
    auth = bearer(await signIn(api));
  });

  afterEach(async () => {
    await api.close();
  });

  it('is empty when no pending or confirmed booking starts from the clock', async () => {
    expect(await upcoming()).toEqual([]);
  });

  it('lists the first eight by start, equal starts in the order they were made', async () => {
    const [one, two, three] = roomIds as [string, string, string];
    const ids = [
      await book(one, '2032-03-02', '09:00', '10:00'),
      await book(two, '2032-03-02', '09:00', '10:00'),
      await book(three, '2032-03-02', '09:00', '10:00'),
      await book(one, '2032-02-01', '12:00', '13:00'),
      await book(one, '2032-02-01', '09:00', '10:00'),
      await book(two, '2032-04-01', '09:00', '10:00'),
      await book(two, '2032-05-01', '09:00', '10:00'),
      await book(two, '2032-06-01', '09:00', '10:00'),
      await book(two, '2032-07-01', '09:00', '10:00'),
      await book(two, '2032-08-01', '09:00', '10:00'),
    ];
    await prisma.client.booking.update({ where: { id: ids[6] }, data: { status: 'confirmed' } });

    const list = await upcoming();

    expect(list.map((item) => item.id)).toEqual([
      ids[4],
      ids[3],
      ids[0],
      ids[1],
      ids[2],
      ids[5],
      ids[6],
      ids[7],
    ]);
  });

  it('leaves out the bookings that are not pending or confirmed', async () => {
    const [, , three] = roomIds as [string, string, string];
    const id = await book(three, '2032-01-05', '09:00', '10:00');
    expect((await upcoming())[0]?.id).toBe(id);

    for (const status of ['checked_in', 'completed', 'cancelled', 'no_show'] as const) {
      await prisma.client.booking.update({ where: { id }, data: { status } });
      expect((await upcoming()).map((item) => item.id)).not.toContain(id);
    }
  });

  it('starts at the instant of the clock, counting a booking that begins at it', async () => {
    const [, two] = roomIds as [string, string];
    const startsAt = new Date('2032-01-01T00:00:00.000Z');
    const { id, seq } = await nextEntityId(prisma.client, 'bk');
    const data = {
      roomId: two,
      memberId,
      attendees: 1,
      status: 'pending' as const,
      notes: null,
      totalPrice: 0,
      createdAt: SEED_NOW,
    };
    await prisma.client.booking.create({
      data: { ...data, id, seq, startsAt, endsAt: new Date(startsAt.getTime() + HOUR) },
    });
    const earlier = await nextEntityId(prisma.client, 'bk');
    const before = new Date(startsAt.getTime() - HOUR);
    await prisma.client.booking.create({
      data: {
        ...data,
        id: earlier.id,
        seq: earlier.seq,
        startsAt: before,
        endsAt: new Date(startsAt.getTime() - 1),
      },
    });

    const ids = (await upcoming()).map((item) => item.id);

    expect(ids[0]).toBe(id);
    expect(ids).not.toContain(earlier.id);
  });
});
