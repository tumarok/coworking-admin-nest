import { Clock } from '../src/common/clock/clock.js';
import { sequenceOf } from '../src/common/ids/ids.js';
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type Booking,
  bookingPageSchema,
  bookingSchema,
  bulkBookingResultSchema,
  MAX_BULK_BOOKINGS,
} from '../src/contract/index.js';
import { nextEntityId } from '../src/database/entity-id.js';
import { type DbClient, PrismaService } from '../src/database/prisma.service.js';
import { generateSeed } from '../src/database/seed/generate-seed.js';
import type { BookingStatus } from '../src/generated/prisma/enums.js';
import { SEED, SEED_NOW } from './support/constants.js';
import { expectContract } from './support/expect-contract.js';
import type { FixedClock } from './support/fixed-clock.js';
import { loadSeedGolden } from './support/golden.js';
import { queuedBehind } from './support/queued-behind.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

const BASE = '/api/v1/bookings';
const DAY = 24 * 3_600_000;

const golden = loadSeedGolden();
const seed = generateSeed({ seed: SEED, now: SEED_NOW });

const REQUIRED = 'Invalid input: expected string, received undefined';
const OVERLAP = 'The room is already booked for this time';
const NOT_EDITABLE = 'Only pending or confirmed bookings can be edited';

// What the mock answers for a list: every booking with the names of its room, location and member,
// filtered by the query, latest start first and in order of creation among equal starts.
const seeded = seed.bookings.map((booking) => {
  const room = seed.rooms.find((r) => r.id === booking.roomId);
  const location = seed.locations.find((l) => l.id === room?.locationId);
  const member = seed.members.find((m) => m.id === booking.memberId);
  return {
    ...booking,
    roomName: room?.name ?? '—',
    locationId: location?.id ?? '',
    locationName: location?.name ?? '—',
    memberName: member ? `${member.firstName} ${member.lastName}` : '—',
  };
});

type Query = Record<string, string | undefined>;

const expected = ({ q, from, to, status, locationId, roomId, memberId }: Query): Booking[] => {
  const fromMs = from ? Date.parse(`${from}T00:00:00.000Z`) : -Infinity;
  const toMs = to ? Date.parse(`${to}T00:00:00.000Z`) + DAY : Infinity;
  const needle = q?.toLowerCase();
  return seeded
    .filter((b) => Date.parse(b.startsAt) >= fromMs && Date.parse(b.startsAt) < toMs)
    .filter(
      (b) =>
        !needle ||
        [b.memberName, b.roomName, b.locationName].some((s) => s.toLowerCase().includes(needle)),
    )
    .filter((b) => !status || b.status === status)
    .filter((b) => !locationId || b.locationId === locationId)
    .filter((b) => !roomId || b.roomId === roomId)
    .filter((b) => !memberId || b.memberId === memberId)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
};

describe('bookings (read)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;

  const list = async (query: Query | string = {}) => {
    const request = api.http.get(BASE).set(auth);
    const { status, body } = await (typeof query === 'string'
      ? api.http.get(`${BASE}${query}`).set(auth)
      : request.query(query));
    expect(status).toBe(200);
    return expectContract(bookingPageSchema, body);
  };
  /** Every booking matching the query, page by page. */
  const everything = async (query: Query) => {
    const items: Booking[] = [];
    let total = 0;
    for (let page = 1; page === 1 || items.length < total; page += 1) {
      const result = await list({ ...query, page: String(page), limit: '100' });
      items.push(...result.items);
      total = result.total;
    }
    return { items, total };
  };
  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
  });

  afterAll(async () => {
    await api.close();
  });

  describe('authentication', () => {
    it.each([
      ['GET', BASE],
      ['GET', `${BASE}/bk_3a`],
      ['POST', BASE],
      ['PATCH', `${BASE}/bk_3a`],
      ['POST', `${BASE}/bk_3a/status`],
      ['POST', `${BASE}/bulk`],
    ] as const)('answers %s %s with 401 without a token', async (method, path) => {
      const { status, body } = await api.http[method.toLowerCase() as 'get'](path);

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });
  });

  describe('GET /bookings', () => {
    it('lists the 1294 bookings, latest start first and oldest made first among equal starts', async () => {
      const { items, total } = await everything({});

      expect(total).toBe(golden.counts.bookings);
      expect(items).toHaveLength(golden.counts.bookings);
      expect(items.map((item) => item.id)).toEqual(expected({}).map((item) => item.id));
    });

    it('returns the first 20 by default', async () => {
      const page = await list();

      expect(page).toMatchObject({ total: 1294, page: 1, limit: 20 });
      expect(ids(page)).toEqual(
        expected({})
          .slice(0, 20)
          .map((item) => item.id),
      );
    });

    it('returns every field with the names of the room, the location and the member', async () => {
      const [first] = (await list({ limit: '1' })).items;

      expect(first).toEqual(expected({})[0]);
      expect(first.roomName).not.toBe('—');
      expect(first.memberName).toMatch(/^\S+ \S+/);
    });

    it('pages the sorted list', async () => {
      const second = await list({ page: '2', limit: '7' });

      expect(second).toMatchObject({ total: 1294, page: 2, limit: 7 });
      expect(ids(second)).toEqual(
        expected({})
          .slice(7, 14)
          .map((item) => item.id),
      );
    });

    it('answers a page beyond the last with no items and the total', async () => {
      expect(await list({ page: '999' })).toEqual({ items: [], total: 1294, page: 999, limit: 20 });
    });

    it('answers the last page with the rest', async () => {
      const page = await list({ page: '13', limit: '100' });

      expect(page.items).toHaveLength(94);
      expect(page.items.at(-1)?.id).toBe(expected({}).at(-1)?.id);
    });

    it.each(Object.entries(golden.bookingsByStatus))(
      'filters by status %s',
      async (status, total) => {
        const page = await list({ status, limit: '100' });

        expect(page.total).toBe(total);
        expect(page.items.every((item) => item.status === status)).toBe(true);
      },
    );

    const [someRoom] = seed.rooms;
    const [someMember] = seed.members;
    const surname = someMember.lastName;
    it.each<[string, Query]>([
      ['one day', { from: '2026-10-14', to: '2026-10-14' }],
      ['from a day on', { from: '2026-10-20' }],
      ['up to a day', { to: '2026-10-01' }],
      ['a range with no bookings', { from: '2030-01-01', to: '2030-01-31' }],
      ['an upside-down range', { from: '2026-10-20', to: '2026-10-10' }],
      ['a location', { locationId: 'loc_1' }],
      ['a location without bookable rooms', { locationId: 'loc_5' }],
      ['a room', { roomId: someRoom.id }],
      ['a member', { memberId: someMember.id }],
      ['a member name', { q: surname }],
      ['a member name in other case', { q: surname.toUpperCase() }],
      ['a room name', { q: 'Cedar' }],
      ['a location name', { q: 'canal yard' }],
      ['text that is no name', { q: 'zzz' }],
      ['% as a plain character', { q: '%' }],
      ['a status and a location', { status: 'confirmed', locationId: 'loc_4' }],
      [
        'everything together',
        { status: 'completed', from: '2026-09-25', to: '2026-10-05', q: 'e' },
      ],
    ])('matches the mock for %s', async (_what, query) => {
      const { items, total } = await everything(query);

      expect(total).toBe(expected(query).length);
      expect(items.map((item) => item.id)).toEqual(expected(query).map((item) => item.id));
    });

    it('counts the day of `to` whole and looks only at the start of a booking', async () => {
      const day = '2026-10-14';
      const { items } = await everything({ from: day, to: day });

      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.startsAt.startsWith(day))).toBe(true);
    });

    it('takes the earliest and the latest day the calendar has', async () => {
      const all = await list({ from: '0000-01-01', to: '9999-12-31' });

      expect(all.total).toBe(1294);
      expect((await list({ to: '0000-01-01' })).total).toBe(0);
      expect((await list({ from: '9999-12-31' })).total).toBe(0);
    });

    it('treats an empty filter as no filter', async () => {
      expect((await list('?q=&from=&to=&status=&locationId=&roomId=&memberId=')).total).toBe(1294);
    });

    it('keeps the last of a repeated key', async () => {
      expect((await list('?status=cancelled&status=checked_in')).total).toBe(7);
    });

    it('ignores unknown keys', async () => {
      expect((await list('?sort=startsAt&foo=bar')).total).toBe(1294);
    });

    it('trims the search text', async () => {
      expect((await list({ q: '  canal yard  ' })).total).toBe(
        expected({ q: 'canal yard' }).length,
      );
    });

    it.each([
      ['limit=abc', { limit: 'Invalid input: expected number, received NaN' }],
      ['limit=0', { limit: 'Too small: expected number to be >=1' }],
      ['limit=101', { limit: 'Too big: expected number to be <=100' }],
      ['page=0', { page: 'Too small: expected number to be >=1' }],
      ['from=2026-13-01', { from: 'Invalid ISO date' }],
      ['to=tomorrow', { to: 'Invalid ISO date' }],
      [
        'status=done',
        {
          status:
            'Invalid option: expected one of "pending"|"confirmed"|"checked_in"|"completed"|"cancelled"|"no_show"',
        },
      ],
    ])('answers 422 for %s', async (query, fieldErrors) => {
      const { status, body } = await api.http.get(`${BASE}?${query}`).set(auth);

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors });
    });
  });

  describe('GET /bookings/:id', () => {
    it('returns the booking', async () => {
      const [target] = expected({ status: 'pending' });
      const { status, body } = await api.http.get(`${BASE}/${target.id}`).set(auth);

      expect(status).toBe(200);
      expect(expectContract(bookingSchema, body)).toEqual(target);
    });

    it('answers a trailing slash', async () => {
      expect((await api.http.get(`${BASE}/bk_3a/`).set(auth)).status).toBe(200);
    });

    it('answers 404 for an unknown id', async () => {
      const { status, body } = await api.http.get(`${BASE}/bk_missing`).set(auth);

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Booking not found' });
    });
  });
});

describe('bookings (write)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let prisma: PrismaService;
  let clock: FixedClock;
  let locationId: string;
  let memberId: string;
  let counter = 0;

  // The location opens at 08:00 and closes at 20:00 in Kyiv, which is 06:00-18:00 UTC in winter.
  const DAY1 = '2026-12-01';
  const slot = (from: string, to: string, day = DAY1) => ({
    startsAt: `${day}T${from}:00.000Z`,
    endsAt: `${day}T${to}:00.000Z`,
  });

  const created = async (path: string, input: object) => {
    const { status, body } = await api.http.post(path).set(auth).send(input);
    expect(status).toBe(201);
    return (body as { id: string }).id;
  };
  const newLocation = (change: object = {}) =>
    created('/api/v1/locations', {
      name: 'Booking Court',
      city: 'Kyiv',
      address: '5 Sadova St',
      timezone: 'Europe/Kyiv',
      opensAt: '08:00',
      closesAt: '20:00',
      status: 'active',
      ...change,
    });
  /** A room of its own, so that the bookings of a test never meet those of another. */
  const newRoom = (change: object = {}) =>
    created('/api/v1/rooms', {
      locationId,
      name: `Room ${++counter}`,
      type: 'meeting_room',
      capacity: 6,
      hourlyRate: 2500,
      amenities: [],
      status: 'available',
      ...change,
    });
  const newMember = (change: object = {}) =>
    created('/api/v1/members', {
      firstName: 'Dana',
      lastName: 'Testova',
      email: `dana${++counter}@example.com`,
      phone: '+380 50 123 45 67',
      company: null,
      plan: 'flex',
      status: 'active',
      ...change,
    });
  const draft = (roomId: string, change: object = {}) => ({
    roomId,
    memberId,
    ...slot('09:00', '10:30'),
    attendees: 4,
    notes: null,
    ...change,
  });

  const post = (input: object) => api.http.post(BASE).set(auth).send(input);
  const patch = (id: string, input: object) =>
    api.http.patch(`${BASE}/${id}`).set(auth).send(input);
  const get = (id: string) => api.http.get(`${BASE}/${id}`).set(auth);
  const create = async (input: object) => {
    const { status, body } = await post(input);
    expect(status).toBe(201);
    return expectContract(bookingSchema, body);
  };
  const setStatus = (id: string, status: BookingStatus) =>
    prisma.client.booking.update({ where: { id }, data: { status } });

  /** A booking written straight into the table, as another transaction would write it. */
  const insertBooking = async (
    client: DbClient,
    roomId: string,
    status: BookingStatus,
    from: string,
    to: string,
  ) => {
    const { id, seq } = await nextEntityId(client, 'bk');
    await client.booking.create({
      data: {
        id,
        seq,
        roomId,
        memberId,
        startsAt: new Date(`${DAY1}T${from}:00.000Z`),
        endsAt: new Date(`${DAY1}T${to}:00.000Z`),
        attendees: 1,
        status,
        notes: null,
        totalPrice: 0,
        createdAt: SEED_NOW,
      },
    });
    return id;
  };

  /** A confirmed booking written straight into the table at exact instants. */
  const insertAt = async (roomId: string, startsAt: string, endsAt: string) => {
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
        status: 'confirmed',
        notes: null,
        totalPrice: 0,
        createdAt: SEED_NOW,
      },
    });
    return id;
  };

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
    prisma = api.app.get(PrismaService);
    clock = api.app.get<FixedClock>(Clock);
    locationId = await newLocation();
    memberId = await newMember();
  });

  afterAll(async () => {
    await api.close();
  });

  describe('POST /bookings', () => {
    it('creates a pending booking with 201, the price, the names and the time of the clock', async () => {
      const roomId = await newRoom();
      const input = draft(roomId, { notes: '  Bring the cables  ' });

      const booking = await create(input);

      expect(booking).toEqual({
        id: expect.stringMatching(/^bk_[0-9a-z]+$/),
        roomId,
        roomName: expect.stringMatching(/^Room \d+$/),
        locationId,
        locationName: 'Booking Court',
        memberId,
        memberName: 'Dana Testova',
        startsAt: '2026-12-01T09:00:00.000Z',
        endsAt: '2026-12-01T10:30:00.000Z',
        attendees: 4,
        status: 'pending',
        notes: 'Bring the cables',
        totalPrice: 3750,
        createdAt: SEED_NOW.toISOString(),
      });
      expect((await get(booking.id)).body).toEqual(booking);
    });

    it('stamps the booking with the clock, not with the time of the booking', async () => {
      const roomId = await newRoom();
      clock.set(new Date('2026-10-14T12:34:56.789Z'));
      try {
        expect((await create(draft(roomId))).createdAt).toBe('2026-10-14T12:34:56.789Z');
      } finally {
        clock.set(SEED_NOW);
      }
    });

    it('gives the next id of the counter every entity shares', async () => {
      const roomId = await newRoom();
      const first = await create(draft(roomId));
      const second = await create(draft(roomId, slot('11:00', '12:00')));

      expect(sequenceOf(first.id)).toBeGreaterThan(golden.sequence);
      expect(sequenceOf(second.id)).toBe(sequenceOf(first.id) + 1);
    });

    it('keeps empty notes empty', async () => {
      const roomId = await newRoom();

      const booking = await create(draft(roomId, { notes: '' }));

      expect(booking.notes).toBe('');
    });

    it('accepts the times without milliseconds and writes them with', async () => {
      const roomId = await newRoom();

      const booking = await create(
        draft(roomId, { startsAt: '2026-12-01T09:00:00Z', endsAt: '2026-12-01T10:00:00Z' }),
      );

      expect(booking).toMatchObject({
        startsAt: '2026-12-01T09:00:00.000Z',
        endsAt: '2026-12-01T10:00:00.000Z',
        totalPrice: 2500,
      });
    });

    it('prices a part of an hour to the nearest cent', async () => {
      const roomId = await newRoom({ hourlyRate: 50 });

      expect((await create(draft(roomId, slot('09:00', '09:45')))).totalPrice).toBe(38);
    });

    it('lists the bookings of a room latest start first', async () => {
      const roomId = await newRoom();
      const early = await create(draft(roomId, slot('07:00', '08:00')));
      const late = await create(draft(roomId, slot('15:00', '16:00')));

      const { body } = await api.http.get(BASE).query({ roomId }).set(auth);

      expect((body.items as { id: string }[]).map((item) => item.id)).toEqual([late.id, early.id]);
    });

    it('files a booking under the day of its start, to the millisecond', async () => {
      const roomId = await newRoom();
      const lastOfDay = await insertAt(
        roomId,
        '2026-12-01T23:59:59.999Z',
        '2026-12-02T00:00:00.000Z',
      );
      const firstOfNext = await insertAt(
        roomId,
        '2026-12-02T00:00:00.000Z',
        '2026-12-02T01:00:00.000Z',
      );
      const onDay = async (day: string) => {
        const { body } = await api.http.get(BASE).query({ roomId, from: day, to: day }).set(auth);
        return (body.items as { id: string }[]).map((item) => item.id);
      };

      expect(await onDay('2026-12-01')).toEqual([lastOfDay]);
      expect(await onDay('2026-12-02')).toEqual([firstOfNext]);
    });

    it.each(['0001-01-01', '9999-12-31'])(
      'books a day as far out as %s, which the calendar of the mock allows',
      async (day) => {
        const roomId = await newRoom();

        const { status, body } = await post(draft(roomId, slot('09:00', '10:00', day)));

        expect(status).toBe(201);
        expect(body).toMatchObject({ startsAt: `${day}T09:00:00.000Z` });
      },
    );

    it('lets bookings that only touch share a room', async () => {
      const roomId = await newRoom();
      await create(draft(roomId, slot('09:00', '10:00')));

      await create(draft(roomId, slot('10:00', '11:00')));
      await create(draft(roomId, slot('08:00', '09:00')));
    });

    it('lets the same slot be booked in another room', async () => {
      await create(draft(await newRoom(), slot('09:00', '10:00')));

      await create(draft(await newRoom(), slot('09:00', '10:00')));
    });

    it('accepts the opening time, the closing time and the longest booking', async () => {
      const roomId = await newRoom();

      await create(draft(roomId, slot('06:00', '14:00')));
      await create(draft(roomId, slot('17:00', '18:00')));
    });

    it('counts the hours in the time zone of the location, whichever the season', async () => {
      const roomId = await newRoom();
      // Kyiv moves its clocks on 2026-03-29: 05:30 UTC is 07:30 before and 08:30 after.
      const before = await post(draft(roomId, slot('05:30', '06:30', '2026-03-28')));
      const after = await post(draft(roomId, slot('05:30', '06:30', '2026-03-30')));

      expect(before.status).toBe(422);
      expect(before.body.fieldErrors).toEqual({
        startsAt: 'Outside opening hours (08:00–20:00 local time)',
      });
      expect(after.status).toBe(201);
    });

    it.each([
      ['starts before opening', slot('05:00', '07:00')],
      ['ends after closing', slot('17:00', '19:00')],
      ['lies after closing', slot('18:30', '19:30')],
    ])('answers 422 for a booking that %s', async (_what, time) => {
      const roomId = await newRoom();

      const { status, body } = await post(draft(roomId, time));

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { startsAt: 'Outside opening hours (08:00–20:00 local time)' },
      });
    });

    it('answers 422 for a booking across local midnight', async () => {
      const roomId = await newRoom();
      const allDay = await newRoom({
        locationId: await newLocation({ opensAt: '00:00', closesAt: '23:59' }),
      });

      for (const room of [roomId, allDay]) {
        const { status } = await post(
          draft(room, { startsAt: '2026-12-01T21:00:00.000Z', endsAt: '2026-12-01T23:00:00.000Z' }),
        );
        expect(status).toBe(422);
      }
    });

    it('answers 409 with the bookings in the way, for every kind of overlap', async () => {
      const roomId = await newRoom();
      const first = await create(draft(roomId, slot('09:00', '11:00')));
      const second = await create(draft(roomId, slot('11:00', '12:00')));

      const { status, body } = await post(draft(roomId, slot('10:00', '11:30')));

      expect(status).toBe(409);
      expect(body).toEqual({
        message: OVERLAP,
        conflicts: [
          {
            id: first.id,
            startsAt: '2026-12-01T09:00:00.000Z',
            endsAt: '2026-12-01T11:00:00.000Z',
          },
          {
            id: second.id,
            startsAt: '2026-12-01T11:00:00.000Z',
            endsAt: '2026-12-01T12:00:00.000Z',
          },
        ],
      });
      for (const time of [slot('09:30', '10:00'), slot('08:00', '13:00'), slot('09:00', '11:00')]) {
        expect((await post(draft(roomId, time))).status).toBe(409);
      }
    });

    it.each(['pending', 'confirmed', 'checked_in'] as const)(
      'answers 409 for a booking that overlaps a %s one',
      async (blocking) => {
        const roomId = await newRoom();
        const { id } = await create(draft(roomId));
        await setStatus(id, blocking);

        expect((await post(draft(roomId))).status).toBe(409);
      },
    );

    it.each(['completed', 'cancelled', 'no_show'] as const)(
      'does not count a %s booking',
      async (finished) => {
        const roomId = await newRoom();
        const { id } = await create(draft(roomId));
        await setStatus(id, finished);

        await create(draft(roomId));
      },
    );

    it('uses up no id on a request that is refused', async () => {
      const roomId = await newRoom();
      const first = await create(draft(roomId));
      expect((await post(draft(roomId, { attendees: 99 }))).status).toBe(422);
      expect((await post(draft(roomId))).status).toBe(409);

      const next = await create(draft(roomId, slot('12:00', '13:00')));

      expect(sequenceOf(next.id)).toBe(sequenceOf(first.id) + 1);
    });

    it('answers 422 with a message for every field an empty-handed request misses', async () => {
      const { status, body } = await post({});

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          roomId: REQUIRED,
          memberId: REQUIRED,
          startsAt: REQUIRED,
          endsAt: REQUIRED,
          attendees: 'Invalid input: expected number, received undefined',
          notes: 'Invalid input: expected string, received undefined',
        },
      });
    });

    it('answers 422 when the body is not JSON', async () => {
      const { status, body } = await api.http
        .post(BASE)
        .set(auth)
        .set('Content-Type', 'application/json')
        .send('{"roomId":');

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({
        _: 'Invalid input: expected object, received undefined',
      });
    });

    it.each([
      [
        'an end before the start',
        { startsAt: `${DAY1}T10:00:00.000Z`, endsAt: `${DAY1}T09:00:00.000Z` },
        { endsAt: 'End must be after start' },
      ],
      [
        'an end at the start',
        { startsAt: `${DAY1}T10:00:00.000Z`, endsAt: `${DAY1}T10:00:00.000Z` },
        { endsAt: 'End must be after start' },
      ],
      [
        'more than 8 hours',
        slot('06:00', '14:01'),
        { endsAt: 'A booking cannot be longer than 8 hours' },
      ],
      ['no attendees', { attendees: 0 }, { attendees: 'At least 1 attendee' }],
      [
        'a fraction of a person',
        { attendees: 1.5 },
        { attendees: 'Invalid input: expected int, received number' },
      ],
      [
        'a text of attendees',
        { attendees: '2' },
        { attendees: 'Invalid input: expected number, received string' },
      ],
      [
        'notes that are too long',
        { notes: 'x'.repeat(501) },
        { notes: 'Too big: expected string to have <=500 characters' },
      ],
      ['a start that is no time', { startsAt: 'tomorrow' }, { startsAt: 'Invalid ISO datetime' }],
      [
        'a time with an offset',
        { startsAt: '2026-12-01T11:00:00+02:00' },
        { startsAt: 'Invalid ISO datetime' },
      ],
    ])('answers 422 for %s', async (_what, change, fieldErrors) => {
      const roomId = await newRoom();

      const { status, body } = await post(draft(roomId, change));

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors });
    });

    it('answers 422 for a room that does not exist, and for nothing else', async () => {
      const { status, body } = await post(
        draft('room_missing', {
          memberId: 'mem_missing',
          attendees: 999,
          ...slot('01:00', '02:00'),
        }),
      );

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { roomId: 'Room not found' },
      });
    });

    it('answers 422 for a deleted room as for a missing one', async () => {
      const roomId = await newRoom();
      await api.http.delete(`/api/v1/rooms/${roomId}`).set(auth).expect(204);

      const { status, body } = await post(draft(roomId));

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ roomId: 'Room not found' });
    });

    it('answers 422 for a member who does not exist or is deleted', async () => {
      const roomId = await newRoom();
      const gone = await newMember();
      await api.http.delete(`/api/v1/members/${gone}`).set(auth).expect(204);

      for (const missing of ['mem_missing', gone]) {
        const { status, body } = await post(draft(roomId, { memberId: missing }));

        expect(status).toBe(422);
        expect(body.fieldErrors).toEqual({ memberId: 'Member not found' });
      }
    });

    it.each(['suspended', 'cancelled'])('answers 422 for a %s member', async (memberStatus) => {
      const roomId = await newRoom();

      const { status, body } = await post(
        draft(roomId, { memberId: await newMember({ status: memberStatus }) }),
      );

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ memberId: `Member is ${memberStatus}` });
    });

    it.each(['maintenance', 'retired'])('answers 422 for a room under %s', async (roomStatus) => {
      const roomId = await newRoom({ status: roomStatus });

      const { status, body } = await post(draft(roomId));

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ roomId: 'This room is not available for booking' });
    });

    it('answers 422 for a room of a closed location', async () => {
      const roomId = await newRoom({ locationId: await newLocation({ status: 'inactive' }) });

      const { status, body } = await post(draft(roomId));

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ roomId: 'This location is closed' });
    });

    it('answers 422 for more attendees than seats, and accepts as many as seats', async () => {
      const roomId = await newRoom({ capacity: 3 });

      const refused = await post(draft(roomId, { attendees: 4 }));

      expect(refused.status).toBe(422);
      expect(refused.body.fieldErrors).toEqual({ attendees: 'This room seats up to 3' });
      await create(draft(roomId, { attendees: 3 }));
    });

    it('reports every problem of the fields together', async () => {
      const roomId = await newRoom({ status: 'maintenance', capacity: 2 });

      const { status, body } = await post(
        draft(roomId, {
          memberId: await newMember({ status: 'suspended' }),
          attendees: 3,
          ...slot('02:00', '03:00'),
        }),
      );

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          roomId: 'This room is not available for booking',
          memberId: 'Member is suspended',
          attendees: 'This room seats up to 2',
          startsAt: 'Outside opening hours (08:00–20:00 local time)',
        },
      });
    });

    it('answers 422 rather than 409 when the rules are broken and the room is taken', async () => {
      const roomId = await newRoom();
      await create(draft(roomId));

      const { status } = await post(draft(roomId, { attendees: 99 }));

      expect(status).toBe(422);
    });

    it('ignores the keys the contract does not know', async () => {
      const roomId = await newRoom();

      const booking = await create(
        draft(roomId, { id: 'bk_mine', status: 'confirmed', totalPrice: 1 }),
      );

      expect(booking).toMatchObject({ status: 'pending', totalPrice: 3750 });
      expect(booking.id).not.toBe('bk_mine');
    });
  });

  describe('a booking of a deleted room, location or member', () => {
    it('keeps the booking and shows a dash for the names that are gone', async () => {
      const roomId = await newRoom();
      const gone = await newMember();
      const { id } = await create(draft(roomId, { memberId: gone }));
      await setStatus(id, 'completed');

      await api.http.delete(`/api/v1/rooms/${roomId}`).set(auth).expect(204);
      await api.http.delete(`/api/v1/members/${gone}`).set(auth).expect(204);

      const { status, body } = await get(id);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        id,
        roomId,
        roomName: '—',
        locationId,
        locationName: '—',
        memberId: gone,
        memberName: '—',
      });
      const listed = await api.http.get(BASE).query({ roomId }).set(auth);
      expect(listed.body.items).toHaveLength(1);
      expect((await api.http.get(BASE).query({ q: '—', roomId }).set(auth)).body.total).toBe(1);
    });
  });

  describe('PATCH /bookings/:id', () => {
    it('replaces the fields, prices the new time and keeps the id, status and creation time', async () => {
      const roomId = await newRoom({ hourlyRate: 1000 });
      const otherRoom = await newRoom({ hourlyRate: 2000 });
      const otherMember = await newMember({ firstName: 'Ira', lastName: 'Kovalenko' });
      const original = await create(draft(roomId));
      await setStatus(original.id, 'confirmed');
      clock.set(new Date('2026-10-14T10:00:00.000Z'));

      try {
        const { status, body } = await patch(original.id, {
          roomId: otherRoom,
          memberId: otherMember,
          ...slot('13:00', '15:00'),
          attendees: 2,
          notes: 'Moved',
        });

        expect(status).toBe(200);
        expect(expectContract(bookingSchema, body)).toEqual({
          ...original,
          roomId: otherRoom,
          roomName: expect.stringMatching(/^Room \d+$/),
          memberId: otherMember,
          memberName: 'Ira Kovalenko',
          startsAt: '2026-12-01T13:00:00.000Z',
          endsAt: '2026-12-01T15:00:00.000Z',
          attendees: 2,
          notes: 'Moved',
          status: 'confirmed',
          totalPrice: 4000,
        });
        expect((await get(original.id)).body).toEqual(body);
      } finally {
        clock.set(SEED_NOW);
      }
    });

    it('does not collide with the booking itself', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId, slot('09:00', '11:00')));

      const longer = await patch(id, draft(roomId, slot('08:00', '12:00')));
      const same = await patch(id, draft(roomId, { ...slot('08:00', '12:00'), attendees: 1 }));

      expect(longer.status).toBe(200);
      expect(same.status).toBe(200);
    });

    it('answers 409 with the other booking, not itself, when the new time is taken', async () => {
      const roomId = await newRoom();
      const mine = await create(draft(roomId, slot('09:00', '10:00')));
      const other = await create(draft(roomId, slot('11:00', '12:00')));

      const { status, body } = await patch(mine.id, draft(roomId, slot('10:30', '11:30')));

      expect(status).toBe(409);
      expect(body).toEqual({
        message: OVERLAP,
        conflicts: [
          {
            id: other.id,
            startsAt: '2026-12-01T11:00:00.000Z',
            endsAt: '2026-12-01T12:00:00.000Z',
          },
        ],
      });
      expect((await get(mine.id)).body).toEqual(mine);
    });

    it('answers 409 when the booking moves to a room that is taken at that time', async () => {
      const taken = await newRoom();
      const free = await newRoom();
      await create(draft(taken, slot('09:00', '10:00')));
      const { id } = await create(draft(free, slot('09:00', '10:00')));

      expect((await patch(id, draft(taken, slot('09:30', '10:30')))).status).toBe(409);
      expect((await patch(id, draft(taken, slot('10:00', '11:00')))).status).toBe(200);
    });

    it('edits a pending and a confirmed booking', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));

      expect((await patch(id, draft(roomId, { attendees: 2 }))).status).toBe(200);
      await setStatus(id, 'confirmed');
      expect((await patch(id, draft(roomId, { attendees: 3 }))).status).toBe(200);
    });

    it.each(['checked_in', 'completed', 'cancelled', 'no_show'] as const)(
      'answers 409 for a %s booking, even when the body is wrong',
      async (finished) => {
        const roomId = await newRoom();
        const booking = await create(draft(roomId));
        await setStatus(booking.id, finished);

        for (const body of [draft(roomId, { attendees: 2 }), {}]) {
          const { status, body: answer } = await patch(booking.id, body);

          expect(status).toBe(409);
          expect(answer).toEqual({ message: NOT_EDITABLE });
        }
        expect((await get(booking.id)).body).toEqual({ ...booking, status: finished });
      },
    );

    it('answers 404 for an unknown id, even when the body is invalid', async () => {
      const roomId = await newRoom();

      for (const body of [draft(roomId), {}]) {
        const { status, body: answer } = await patch('bk_missing', body);

        expect(status).toBe(404);
        expect(answer).toEqual({ message: 'Booking not found' });
      }
    });

    it('answers 404 first and 422 for a body that is not JSON', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));
      const send = (target: string) =>
        api.http
          .patch(`${BASE}/${target}`)
          .set(auth)
          .set('Content-Type', 'application/json')
          .send('{"roomId":');

      expect((await send('bk_missing')).status).toBe(404);
      const { status, body } = await send(id);
      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ _: 'Invalid input: expected object, received undefined' });
    });

    it('answers 422 and changes nothing for a partial body', async () => {
      const roomId = await newRoom();
      const booking = await create(draft(roomId));

      const { status, body } = await patch(booking.id, { attendees: 2 });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({
        roomId: REQUIRED,
        memberId: REQUIRED,
        startsAt: REQUIRED,
        endsAt: REQUIRED,
        notes: 'Invalid input: expected string, received undefined',
      });
      expect((await get(booking.id)).body).toEqual(booking);
    });

    it('answers 422 for a bad time and for broken rules, which come before an overlap', async () => {
      const roomId = await newRoom();
      const mine = await create(draft(roomId, slot('09:00', '10:00')));
      await create(draft(roomId, slot('11:00', '12:00')));

      const reversed = await patch(
        mine.id,
        draft(roomId, { startsAt: `${DAY1}T11:30:00.000Z`, endsAt: `${DAY1}T11:00:00.000Z` }),
      );
      const crowded = await patch(
        mine.id,
        draft(roomId, { ...slot('11:00', '12:00'), attendees: 99 }),
      );

      expect(reversed.status).toBe(422);
      expect(reversed.body.fieldErrors).toEqual({ endsAt: 'End must be after start' });
      expect(crowded.status).toBe(422);
      expect(crowded.body.fieldErrors).toEqual({ attendees: 'This room seats up to 6' });
    });

    it('checks the member again, so the booking of a suspended member cannot be edited', async () => {
      const roomId = await newRoom();
      const member = await newMember();
      const { id } = await create(draft(roomId, { memberId: member }));
      await api.http
        .patch(`/api/v1/members/${member}`)
        .set(auth)
        .send({
          firstName: 'Dana',
          lastName: 'Testova',
          email: `late${++counter}@example.com`,
          phone: '+380 50 123 45 67',
          company: null,
          plan: 'flex',
          status: 'suspended',
        })
        .expect(200);

      const { status, body } = await patch(id, draft(roomId, { memberId: member }));

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ memberId: 'Member is suspended' });
    });

    it('answers 422 for a room or member that does not exist', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));

      expect((await patch(id, draft('room_missing'))).body.fieldErrors).toEqual({
        roomId: 'Room not found',
      });
      expect(
        (await patch(id, draft(roomId, { memberId: 'mem_missing' }))).body.fieldErrors,
      ).toEqual({
        memberId: 'Member not found',
      });
    });

    it('ignores the keys the contract does not know', async () => {
      const roomId = await newRoom();
      const booking = await create(draft(roomId));

      const { body } = await patch(
        booking.id,
        draft(roomId, {
          id: 'bk_mine',
          status: 'completed',
          totalPrice: 1,
          createdAt: '2020-01-01T00:00:00.000Z',
        }),
      );

      expect(body).toEqual(booking);
    });
  });

  describe('POST /bookings/:id/status', () => {
    const change = (id: string, status: unknown) =>
      api.http.post(`${BASE}/${id}/status`).set(auth).send({ status });
    /** A booking in its own room, moved straight to `status` in the table. */
    const inStatus = async (status: BookingStatus) => {
      const booking = await create(draft(await newRoom()));
      await setStatus(booking.id, status);
      return { ...booking, status };
    };

    it.each(BOOKING_STATUSES.flatMap((from) => BOOKING_STATUSES.map((to) => [from, to] as const)))(
      'from %s to %s follows the table of transitions',
      async (from, to) => {
        const booking = await inStatus(from);

        const { status, body } = await change(booking.id, to);

        if (BOOKING_TRANSITIONS[from].includes(to)) {
          expect(status).toBe(200);
          expect(expectContract(bookingSchema, body)).toEqual({ ...booking, status: to });
        } else {
          expect(status).toBe(409);
          expect(body).toEqual({
            message: `Cannot change status from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}`,
          });
        }
        const stored = (await get(booking.id)).body as Booking;
        expect(stored.status).toBe(BOOKING_TRANSITIONS[from].includes(to) ? to : from);
      },
    );

    it.each([
      ['pending', 'confirmed'],
      ['pending', 'cancelled'],
      ['confirmed', 'checked_in'],
      ['confirmed', 'cancelled'],
      ['confirmed', 'no_show'],
      ['checked_in', 'completed'],
    ] as const)('moves a %s booking to %s with 200 and the whole booking', async (from, to) => {
      const booking = await inStatus(from);

      const { status, body } = await change(booking.id, to);

      expect(status).toBe(200);
      expect(expectContract(bookingSchema, body)).toEqual({ ...booking, status: to });
      expect((await get(booking.id)).body).toEqual({ ...booking, status: to });
    });

    it.each([
      ['completed', 'pending', 'Cannot change status from completed to pending'],
      ['checked_in', 'pending', 'Cannot change status from checked in to pending'],
      ['checked_in', 'cancelled', 'Cannot change status from checked in to cancelled'],
      ['no_show', 'checked_in', 'Cannot change status from no show to checked in'],
      ['cancelled', 'confirmed', 'Cannot change status from cancelled to confirmed'],
      ['pending', 'pending', 'Cannot change status from pending to pending'],
      ['pending', 'checked_in', 'Cannot change status from pending to checked in'],
    ] as const)('refuses %s to %s with 409 "%s"', async (from, to, message) => {
      const booking = await inStatus(from);

      const { status, body } = await change(booking.id, to);

      expect(status).toBe(409);
      expect(body).toEqual({ message });
      expect((await get(booking.id)).body).toEqual(booking);
    });

    it('walks a booking from pending to completed', async () => {
      const { id } = await create(draft(await newRoom()));

      for (const next of ['confirmed', 'checked_in', 'completed'] as const) {
        const { status, body } = await change(id, next);
        expect(status).toBe(200);
        expect(expectContract(bookingSchema, body).status).toBe(next);
      }
      expect((await change(id, 'cancelled')).status).toBe(409);
    });

    it('applies no rule of the room, the member or the time, as the mock does', async () => {
      const roomId = await newRoom();
      const suspended = await newMember();
      const booking = await create(draft(roomId, { memberId: suspended }));
      await prisma.client.member.update({
        where: { id: suspended },
        data: { status: 'suspended' },
      });
      await prisma.client.room.update({ where: { id: roomId }, data: { status: 'maintenance' } });
      await prisma.client.member.update({
        where: { id: suspended },
        data: { deletedAt: SEED_NOW },
      });
      await prisma.client.room.update({ where: { id: roomId }, data: { deletedAt: SEED_NOW } });

      const { status, body } = await change(booking.id, 'confirmed');

      expect(status).toBe(200);
      expect(expectContract(bookingSchema, body)).toMatchObject({
        status: 'confirmed',
        roomName: '—',
        memberName: '—',
      });
    });

    it('frees the room when the booking is cancelled', async () => {
      const roomId = await newRoom();
      const booking = await create(draft(roomId));
      expect((await post(draft(roomId))).status).toBe(409);

      expect((await change(booking.id, 'cancelled')).status).toBe(200);

      expect((await post(draft(roomId))).status).toBe(201);
    });

    it('answers 401 without a token', async () => {
      const { status, body } = await api.http
        .post(`${BASE}/bk_3a/status`)
        .send({ status: 'confirmed' });

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });

    it('answers 404 for an unknown id, even when the body is invalid', async () => {
      for (const body of [{ status: 'confirmed' }, {}, { status: 'done' }]) {
        const answer = await api.http.post(`${BASE}/bk_missing/status`).set(auth).send(body);

        expect(answer.status).toBe(404);
        expect(answer.body).toEqual({ message: 'Booking not found' });
      }
    });

    it('answers 422 before 409 for an invalid body on a booking that is past changing', async () => {
      const booking = await inStatus('completed');

      const { status, body } = await change(booking.id, 'done');

      expect(status).toBe(422);
      expect(body.fieldErrors).toHaveProperty('status');
    });

    it.each([
      [
        'a missing status',
        {},
        {
          status:
            'Invalid option: expected one of "pending"|"confirmed"|"checked_in"|"completed"|"cancelled"|"no_show"',
        },
      ],
      [
        'an unknown status',
        { status: 'done' },
        {
          status:
            'Invalid option: expected one of "pending"|"confirmed"|"checked_in"|"completed"|"cancelled"|"no_show"',
        },
      ],
      [
        'a status of the wrong type',
        { status: 5 },
        {
          status:
            'Invalid option: expected one of "pending"|"confirmed"|"checked_in"|"completed"|"cancelled"|"no_show"',
        },
      ],
      [
        'a body that is not an object',
        'confirmed',
        { _: 'Invalid input: expected object, received string' },
      ],
      ['a null body', null, { _: 'Invalid input: expected object, received null' }],
    ])(
      'answers 422 with the exact field errors for %s and changes nothing',
      async (_name, send, fieldErrors) => {
        const booking = await inStatus('pending');

        const { status, body } = await api.http
          .post(`${BASE}/${booking.id}/status`)
          .set(auth)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(send));

        expect(status).toBe(422);
        expect(body).toEqual({ message: 'Validation failed', fieldErrors });
        expect((await get(booking.id)).body).toEqual(booking);
      },
    );

    it('answers 422 when the body is not JSON', async () => {
      const booking = await inStatus('pending');

      const { status, body } = await api.http
        .post(`${BASE}/${booking.id}/status`)
        .set(auth)
        .set('Content-Type', 'application/json')
        .send('{"status":');

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({
        _: 'Invalid input: expected object, received undefined',
      });
    });

    it('ignores the keys the contract does not know', async () => {
      const booking = await inStatus('pending');

      const { status, body } = await api.http
        .post(`${BASE}/${booking.id}/status`)
        .set(auth)
        .send({ status: 'confirmed', id: 'bk_other', notes: 'changed' });

      expect(status).toBe(200);
      expect(expectContract(bookingSchema, body)).toEqual({ ...booking, status: 'confirmed' });
    });

    it('answers a trailing slash', async () => {
      const booking = await inStatus('pending');

      const { status } = await api.http
        .post(`${BASE}/${booking.id}/status/`)
        .set(auth)
        .send({ status: 'confirmed' });

      expect(status).toBe(200);
    });
  });

  describe('POST /bookings/bulk', () => {
    const bulk = (ids: unknown, action: unknown = 'confirm') =>
      api.http.post(`${BASE}/bulk`).set(auth).send({ ids, action });
    const result = async (ids: string[], action: 'confirm' | 'cancel' = 'confirm') => {
      const { status, body } = await bulk(ids, action);
      expect(status).toBe(200);
      return expectContract(bulkBookingResultSchema, body);
    };
    const statusOf = async (id: string) => ((await get(id)).body as Booking).status;
    /** Bookings in one room, an hour each, moved straight to the given statuses. */
    const made = async (statuses: BookingStatus[]) => {
      const roomId = await newRoom();
      const ids: string[] = [];
      for (const [index, status] of statuses.entries()) {
        const hour = String(6 + index).padStart(2, '0');
        const booking = await create(
          draft(roomId, slot(`${hour}:00`, `${String(7 + index).padStart(2, '0')}:00`)),
        );
        await setStatus(booking.id, status);
        ids.push(booking.id);
      }
      return ids;
    };

    it.each([
      ['confirm', 'pending', 'confirmed'],
      ['confirm', 'confirmed', undefined],
      ['confirm', 'checked_in', undefined],
      ['confirm', 'completed', undefined],
      ['confirm', 'cancelled', undefined],
      ['confirm', 'no_show', undefined],
      ['cancel', 'pending', 'cancelled'],
      ['cancel', 'confirmed', 'cancelled'],
      ['cancel', 'checked_in', undefined],
      ['cancel', 'completed', undefined],
      ['cancel', 'cancelled', undefined],
      ['cancel', 'no_show', undefined],
    ] as const)('%s on a %s booking moves it to %s', async (action, from, to) => {
      const [id] = await made([from]);

      const answer = await result([id], action);

      if (to) {
        expect(answer).toEqual({ updated: [id], failed: [] });
        expect(await statusOf(id)).toBe(to);
      } else {
        expect(answer).toEqual({
          updated: [],
          failed: [{ id, reason: `Cannot ${action} a booking that is ${from.replace('_', ' ')}` }],
        });
        expect(await statusOf(id)).toBe(from);
      }
    });

    it('confirms a pending booking and refuses a completed one, as the mock does', async () => {
      const [pending, completed] = await made(['pending', 'completed']);

      expect(await result([pending, completed])).toEqual({
        updated: [pending],
        failed: [{ id: completed, reason: 'Cannot confirm a booking that is completed' }],
      });
    });

    it('answers a missing id and a checked in booking with their reasons', async () => {
      const [pending, confirmed, checkedIn] = await made(['pending', 'confirmed', 'checked_in']);

      expect(await result([pending, confirmed, 'bk_missing', checkedIn])).toEqual({
        updated: [pending],
        failed: [
          { id: confirmed, reason: 'Cannot confirm a booking that is confirmed' },
          { id: 'bk_missing', reason: 'Booking not found' },
          { id: checkedIn, reason: 'Cannot confirm a booking that is checked in' },
        ],
      });
    });

    it('keeps the order of the request in both lists', async () => {
      const ids = await made(['pending', 'completed', 'pending', 'cancelled', 'pending']);
      const [a, b, c, d, e] = ids;

      const answer = await result([e, d, 'bk_missing', c, b, a]);

      expect(answer.updated).toEqual([e, c, a]);
      expect(answer.failed.map((failure) => failure.id)).toEqual([d, 'bk_missing', b]);
    });

    it('lets the later copies of a repeated id fail, as the mock does', async () => {
      const [pending, confirmed] = await made(['pending', 'confirmed']);

      expect(await result([pending, pending, confirmed, pending])).toEqual({
        updated: [pending],
        failed: [
          { id: pending, reason: 'Cannot confirm a booking that is confirmed' },
          { id: confirmed, reason: 'Cannot confirm a booking that is confirmed' },
          { id: pending, reason: 'Cannot confirm a booking that is confirmed' },
        ],
      });
      expect(await result([confirmed, confirmed], 'cancel')).toEqual({
        updated: [confirmed],
        failed: [{ id: confirmed, reason: 'Cannot cancel a booking that is cancelled' }],
      });
    });

    it('repeats the reason of a missing id for each copy', async () => {
      expect(await result(['bk_missing', 'bk_missing'], 'cancel')).toEqual({
        updated: [],
        failed: [
          { id: 'bk_missing', reason: 'Booking not found' },
          { id: 'bk_missing', reason: 'Booking not found' },
        ],
      });
    });

    it('applies the ones that can move although others fail, and changes nothing else', async () => {
      const [pending, completed, confirmed] = await made(['pending', 'completed', 'confirmed']);
      const before = (await get(pending)).body as Booking;

      await result([completed, pending, 'bk_missing', confirmed], 'cancel');

      expect(await statusOf(pending)).toBe('cancelled');
      expect(await statusOf(confirmed)).toBe('cancelled');
      expect(await statusOf(completed)).toBe('completed');
      expect((await get(pending)).body).toEqual({ ...before, status: 'cancelled' });
    });

    it('is the answer of every request that is valid, whatever happens to the bookings', async () => {
      expect(await result(['bk_missing'])).toEqual({
        updated: [],
        failed: [{ id: 'bk_missing', reason: 'Booking not found' }],
      });
    });

    it('accepts as many ids as the contract allows', async () => {
      const ids = Array.from({ length: MAX_BULK_BOOKINGS }, (_, index) => `bk_none${index}`);

      const answer = await result(ids);

      expect(answer.updated).toEqual([]);
      expect(answer.failed.map((failure) => failure.id)).toEqual(ids);
    });

    it('answers 401 without a token', async () => {
      const { status, body } = await api.http
        .post(`${BASE}/bulk`)
        .send({ ids: ['bk_3a'], action: 'confirm' });

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });

    it('answers 422 for no ids', async () => {
      const { status, body } = await bulk([]);

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { ids: 'Too small: expected array to have >=1 items' },
      });
    });

    it('answers 422 for more ids than the contract allows, and changes nothing', async () => {
      const [id] = await made(['pending']);
      const ids = [
        id,
        ...Array.from({ length: MAX_BULK_BOOKINGS }, (_, index) => `bk_none${index}`),
      ];

      const { status, body } = await bulk(ids);

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { ids: `Too big: expected array to have <=${MAX_BULK_BOOKINGS} items` },
      });
      expect(await statusOf(id)).toBe('pending');
    });

    it('answers 422 with a message for every field an empty-handed request misses', async () => {
      const { status, body } = await api.http.post(`${BASE}/bulk`).set(auth).send({});

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          ids: 'Invalid input: expected array, received undefined',
          action: expect.stringContaining('Invalid option: expected one of "confirm"|"cancel"'),
        },
      });
    });

    it.each([
      ['an unknown action', ['bk_1'], 'delete', 'action'],
      ['an action of the wrong type', ['bk_1'], 5, 'action'],
      ['an empty id', [''], 'confirm', 'ids.0'],
      ['an id that is not text', ['bk_1', 7], 'confirm', 'ids.1'],
      ['ids that are not a list', 'bk_1', 'confirm', 'ids'],
    ])('answers 422 for %s', async (_name, ids, action, key) => {
      const { status, body } = await bulk(ids, action);

      expect(status).toBe(422);
      expect(Object.keys(body.fieldErrors as object)).toEqual([key]);
    });

    it('answers 422 when the body is not JSON', async () => {
      const { status, body } = await api.http
        .post(`${BASE}/bulk`)
        .set(auth)
        .set('Content-Type', 'application/json')
        .send('{"ids":');

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({
        _: 'Invalid input: expected object, received undefined',
      });
    });

    it('ignores the keys the contract does not know', async () => {
      const [id] = await made(['pending']);

      const { status, body } = await api.http
        .post(`${BASE}/bulk`)
        .set(auth)
        .send({ ids: [id], action: 'confirm', status: 'cancelled' });

      expect(status).toBe(200);
      expect(expectContract(bulkBookingResultSchema, body)).toEqual({ updated: [id], failed: [] });
      expect(await statusOf(id)).toBe('confirmed');
    });

    it('is not an id: a GET of it answers 404 as the mock does', async () => {
      const { status, body } = await get('bulk');

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Booking not found' });
    });
  });

  describe('the rule against overlapping bookings in the database', () => {
    it('refuses a second booking that occupies the room at the same time', async () => {
      const roomId = await newRoom();
      await insertBooking(prisma.client, roomId, 'confirmed', '09:00', '11:00');

      await expect(
        insertBooking(prisma.client, roomId, 'pending', '10:00', '12:00'),
      ).rejects.toThrow(/23P01|bookings_room_no_overlap/);
    });

    it('lets bookings that touch, that are finished or that are in another room share the time', async () => {
      const roomId = await newRoom();
      await insertBooking(prisma.client, roomId, 'confirmed', '09:00', '11:00');

      await insertBooking(prisma.client, roomId, 'pending', '11:00', '12:00');
      await insertBooking(prisma.client, roomId, 'cancelled', '09:00', '11:00');
      await insertBooking(prisma.client, roomId, 'completed', '10:00', '11:00');
      await insertBooking(prisma.client, await newRoom(), 'confirmed', '09:00', '11:00');
    });
  });

  describe('requests that race', () => {
    it('lets one of two simultaneous requests for the same slot win', async () => {
      const roomId = await newRoom();

      const answers = await Promise.all([post(draft(roomId)), post(draft(roomId))]);

      const winner = answers.find((answer) => answer.status === 201);
      const loser = answers.find((answer) => answer.status === 409);
      expect(winner).toBeDefined();
      expect(loser?.body).toEqual({
        message: OVERLAP,
        conflicts: [
          {
            id: (winner?.body as { id: string }).id,
            startsAt: '2026-12-01T09:00:00.000Z',
            endsAt: '2026-12-01T10:30:00.000Z',
          },
        ],
      });
    });

    it('answers 409 with the booking in the way when the database refuses the write', async () => {
      const roomId = await newRoom();
      let held = '';

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          held = await insertBooking(tx, roomId, 'confirmed', '09:00', '10:00');
        },
        () => post(draft(roomId, slot('09:30', '10:30'))),
      );

      expect(answer.status).toBe(409);
      expect(answer.body).toEqual({
        message: OVERLAP,
        conflicts: [
          { id: held, startsAt: '2026-12-01T09:00:00.000Z', endsAt: '2026-12-01T10:00:00.000Z' },
        ],
      });
    });

    it('answers 201 when the booking that blocked the write is rolled back', async () => {
      const roomId = await newRoom();

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await insertBooking(tx, roomId, 'confirmed', '09:00', '10:00');
        },
        () => post(draft(roomId, slot('09:30', '10:30'))),
        { commit: false },
      );

      expect(answer.status).toBe(201);
    });

    it('answers 409 to an edit that the database refuses', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId, slot('12:00', '13:00')));
      let held = '';

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          held = await insertBooking(tx, roomId, 'pending', '09:00', '10:00');
        },
        () => patch(id, draft(roomId, slot('09:30', '10:30'))),
      );

      expect(answer.status).toBe(409);
      expect(answer.body.conflicts).toEqual([
        { id: held, startsAt: '2026-12-01T09:00:00.000Z', endsAt: '2026-12-01T10:00:00.000Z' },
      ]);
      expect((await get(id)).body).toMatchObject(slot('12:00', '13:00'));
    });

    it('answers 422 when the room is deleted while the booking is being made', async () => {
      const roomId = await newRoom();

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
          await tx.room.update({ where: { id: roomId }, data: { deletedAt: SEED_NOW } });
        },
        () => post(draft(roomId)),
      );

      expect(answer.status).toBe(422);
      expect(answer.body.fieldErrors).toEqual({ roomId: 'Room not found' });
    });

    it('answers 422 when the member is deleted while the booking is being made', async () => {
      const roomId = await newRoom();
      const doomed = await newMember();

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM members WHERE id = ${doomed} FOR UPDATE`;
          await tx.member.update({ where: { id: doomed }, data: { deletedAt: SEED_NOW } });
        },
        () => post(draft(roomId, { memberId: doomed })),
      );

      expect(answer.status).toBe(422);
      expect(answer.body.fieldErrors).toEqual({ memberId: 'Member not found' });
    });

    it('answers 422 when the room is deleted while a booking is being moved into it', async () => {
      const roomId = await newRoom();
      const doomed = await newRoom();
      const { id } = await create(draft(roomId));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${doomed} FOR UPDATE`;
          await tx.room.update({ where: { id: doomed }, data: { deletedAt: SEED_NOW } });
        },
        () => patch(id, draft(doomed)),
      );

      expect(answer.status).toBe(422);
      expect(answer.body.fieldErrors).toEqual({ roomId: 'Room not found' });
      expect((await get(id)).body).toMatchObject({ roomId });
    });

    it('answers 422 when the member is deleted while a booking is being handed to them', async () => {
      const roomId = await newRoom();
      const doomed = await newMember();
      const { id } = await create(draft(roomId));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM members WHERE id = ${doomed} FOR UPDATE`;
          await tx.member.update({ where: { id: doomed }, data: { deletedAt: SEED_NOW } });
        },
        () => patch(id, draft(roomId, { memberId: doomed })),
      );

      expect(answer.status).toBe(422);
      expect(answer.body.fieldErrors).toEqual({ memberId: 'Member not found' });
      expect((await get(id)).body).toMatchObject({ memberId });
    });

    it('refuses to delete a member whose booking is being made', async () => {
      const roomId = await newRoom();
      const member = await newMember();

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM members WHERE id = ${member} FOR SHARE`;
          await tx.booking.create({
            data: {
              ...(await nextEntityId(tx, 'bk')),
              roomId,
              memberId: member,
              startsAt: new Date(`${DAY1}T09:00:00.000Z`),
              endsAt: new Date(`${DAY1}T10:00:00.000Z`),
              attendees: 1,
              status: 'pending',
              notes: null,
              totalPrice: 0,
              createdAt: SEED_NOW,
            },
          });
        },
        () => api.http.delete(`/api/v1/members/${member}`).set(auth),
      );

      expect(answer.status).toBe(409);
    });

    it('answers 409 to an edit of a booking that was cancelled meanwhile', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`;
          await tx.booking.update({ where: { id }, data: { status: 'cancelled' } });
        },
        () => patch(id, draft(roomId, { attendees: 2 })),
      );

      expect(answer.status).toBe(409);
      expect(answer.body).toEqual({ message: NOT_EDITABLE });
      expect((await get(id)).body).toMatchObject({ status: 'cancelled', attendees: 4 });
    });

    it('refuses to delete a room whose booking is being made', async () => {
      const roomId = await newRoom();

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR SHARE`;
          await insertBooking(tx, roomId, 'pending', '09:00', '10:00');
        },
        () => api.http.delete(`/api/v1/rooms/${roomId}`).set(auth),
      );

      expect(answer.status).toBe(409);
    });
  });

  describe('status changes that race', () => {
    const change = (id: string, status: BookingStatus) =>
      api.http.post(`${BASE}/${id}/status`).set(auth).send({ status });
    const bulk = (ids: string[], action: 'confirm' | 'cancel') =>
      api.http.post(`${BASE}/bulk`).set(auth).send({ ids, action });
    const lock = (tx: DbClient, id: string) =>
      tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`;
    const statusOf = async (id: string) => ((await get(id)).body as Booking).status;

    it('lets one of two parallel requests for the same move win', async () => {
      const { id } = await create(draft(await newRoom()));

      const answers = await Promise.all([change(id, 'confirmed'), change(id, 'confirmed')]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      expect(answers.find((answer) => answer.status === 409)?.body).toEqual({
        message: 'Cannot change status from confirmed to confirmed',
      });
      expect(await statusOf(id)).toBe('confirmed');
    });

    it('lets only one of two moves that exclude each other win', async () => {
      const { id } = await create(draft(await newRoom()));
      await setStatus(id, 'confirmed');

      const answers = await Promise.all([change(id, 'checked_in'), change(id, 'cancelled')]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const winner = answers.find((answer) => answer.status === 200);
      expect(expectContract(bookingSchema, winner?.body).status).toBe(await statusOf(id));
      expect(answers.find((answer) => answer.status === 409)?.body.message).toMatch(
        /^Cannot change status from (checked in|cancelled) to (cancelled|checked in)$/,
      );
    });

    it('judges a move by the status the booking has once the lock is free', async () => {
      const { id } = await create(draft(await newRoom()));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await lock(tx, id);
          await tx.booking.update({ where: { id }, data: { status: 'cancelled' } });
        },
        () => change(id, 'confirmed'),
      );

      expect(answer.status).toBe(409);
      expect(answer.body).toEqual({ message: 'Cannot change status from cancelled to confirmed' });
      expect(await statusOf(id)).toBe('cancelled');
    });

    it('moves the booking when the transaction that held it is rolled back', async () => {
      const { id } = await create(draft(await newRoom()));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await lock(tx, id);
          await tx.booking.update({ where: { id }, data: { status: 'cancelled' } });
        },
        () => change(id, 'confirmed'),
        { commit: false },
      );

      expect(answer.status).toBe(200);
      expect(expectContract(bookingSchema, answer.body).status).toBe('confirmed');
    });

    it('returns the fields an edit changed while the move waited for it', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await lock(tx, id);
          await tx.booking.update({ where: { id }, data: { attendees: 2, notes: 'edited' } });
        },
        () => change(id, 'confirmed'),
      );

      expect(answer.status).toBe(200);
      expect(expectContract(bookingSchema, answer.body)).toMatchObject({
        status: 'confirmed',
        attendees: 2,
        notes: 'edited',
      });
    });

    it('answers 409 to an edit of a booking whose status was changed meanwhile', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await lock(tx, id);
          await tx.booking.update({ where: { id }, data: { status: 'cancelled' } });
        },
        () => patch(id, draft(roomId, { attendees: 2 })),
      );

      expect(answer.status).toBe(409);
      expect(answer.body).toEqual({ message: NOT_EDITABLE });
    });

    it('lets an edit and a move race without losing either', async () => {
      const roomId = await newRoom();
      const { id } = await create(draft(roomId));

      const answers = await Promise.all([
        patch(id, draft(roomId, { attendees: 2 })),
        change(id, 'confirmed'),
      ]);

      expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
      expect((await get(id)).body).toMatchObject({ status: 'confirmed', attendees: 2 });
    });

    it('judges a bulk request by the statuses once the locks are free', async () => {
      const first = await create(draft(await newRoom()));
      const second = await create(draft(await newRoom()));

      const answer = await queuedBehind(
        prisma,
        async (tx) => {
          await lock(tx, second.id);
          await tx.booking.update({ where: { id: second.id }, data: { status: 'cancelled' } });
        },
        () => bulk([first.id, second.id], 'confirm'),
      );

      expect(answer.status).toBe(200);
      expect(expectContract(bulkBookingResultSchema, answer.body)).toEqual({
        updated: [first.id],
        failed: [{ id: second.id, reason: 'Cannot confirm a booking that is cancelled' }],
      });
    });

    it('waits for a booking that another transaction holds and then moves them all', async () => {
      const first = await create(draft(await newRoom()));
      const second = await create(draft(await newRoom()));

      const answer = await queuedBehind(
        prisma,
        (tx) => lock(tx, second.id).then(() => undefined),
        () => bulk([first.id, second.id], 'cancel'),
      );

      expect(answer.body).toEqual({ updated: [first.id, second.id], failed: [] });
      expect(await statusOf(first.id)).toBe('cancelled');
      expect(await statusOf(second.id)).toBe('cancelled');
    });

    it('locks the bookings in the order they were made, whatever the order of the request', async () => {
      const low = await create(draft(await newRoom()));
      const high = await create(draft(await newRoom()));
      let lowIsHeld = false;

      const answer = await queuedBehind(
        prisma,
        (tx) => lock(tx, high.id).then(() => undefined),
        () => bulk([high.id, low.id], 'confirm'),
        {
          // The request waits for `high`, so it must already hold `low`, which has the lower seq.
          whileQueued: async () => {
            await prisma.client
              .$transaction(
                (tx) =>
                  tx.$queryRaw`SELECT id FROM bookings WHERE id = ${low.id} FOR UPDATE NOWAIT`,
              )
              .catch(() => {
                lowIsHeld = true;
              });
          },
        },
      );

      expect(lowIsHeld).toBe(true);
      expect(answer.body).toEqual({ updated: [high.id, low.id], failed: [] });
    });

    it('lets two bulk requests that name the same bookings in opposite order both finish', async () => {
      const room = await newRoom();
      const ids: string[] = [];
      for (let hour = 6; hour < 14; hour += 1) {
        const from = `${String(hour).padStart(2, '0')}:00`;
        const to = `${String(hour + 1).padStart(2, '0')}:00`;
        ids.push((await create(draft(room, slot(from, to)))).id);
      }

      const answers = await Promise.all([
        bulk(ids, 'confirm'),
        bulk([...ids].reverse(), 'confirm'),
      ]);

      expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
      const [a, b] = answers.map((answer) => expectContract(bulkBookingResultSchema, answer.body));
      expect([...a.updated, ...b.updated].sort()).toEqual([...ids].sort());
      expect([...a.failed, ...b.failed]).toHaveLength(ids.length);
      for (const id of ids) expect(await statusOf(id)).toBe('confirmed');
    });

    it('lets a bulk request and a single move race for one booking', async () => {
      const { id } = await create(draft(await newRoom()));

      const [single, many] = await Promise.all([change(id, 'confirmed'), bulk([id], 'confirm')]);

      const bulked = expectContract(bulkBookingResultSchema, many.body);
      expect([single.status, bulked.updated.length]).toSatisfy(
        ([code, count]: number[]) => (code === 200 && count === 0) || (code === 409 && count === 1),
      );
      expect(await statusOf(id)).toBe('confirmed');
    });
  });
});
