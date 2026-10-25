import {
  type Booking,
  bookingSchema,
  locationSchema,
  memberSchema,
  roomSchema,
} from '../src/contract/index.js';
import { expectContract } from './support/expect-contract.js';
import { loadSeedGolden } from './support/golden.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

const PARALLEL = 8;
const DAY = '2026-11-10';
const slot = (from: string, to: string) => ({
  startsAt: `${DAY}T${from}:00.000Z`,
  endsAt: `${DAY}T${to}:00.000Z`,
});
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const tally = (statuses: number[]) =>
  statuses.reduce<Record<number, number>>((counts, status) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

// Requests that reach the API at the same moment: the outcome has to be one of the serial ones, and
// the same whichever request wins.
describe('concurrent requests', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let sequence = 0;

  beforeAll(async () => {
    api = await seededApp({ ENABLE_RESET: 'true' });
    // Supertest adds a few listeners to the server for every request in flight.
    api.app.getHttpServer().setMaxListeners(PARALLEL * 8);
    auth = bearer(await signIn(api));
  });

  afterAll(async () => {
    await api.close();
  });

  const createLocation = async () => {
    sequence += 1;
    const { status, body } = await api.http
      .post('/api/v1/locations')
      .set(auth)
      .send({
        name: `Parallel Hub ${sequence}`,
        city: 'Kyiv',
        address: '1 Test Street',
        timezone: 'Europe/Kyiv',
        opensAt: '08:00',
        closesAt: '20:00',
        status: 'active',
      });
    expect(status).toBe(201);
    return expectContract(locationSchema, body);
  };

  const createRoom = async (locationId: string, capacity = 6) => {
    sequence += 1;
    const { status, body } = await api.http
      .post('/api/v1/rooms')
      .set(auth)
      .send({
        locationId,
        name: `Parallel Room ${sequence}`,
        type: 'meeting_room',
        capacity,
        hourlyRate: 2000,
        amenities: [],
        status: 'available',
      });
    expect(status).toBe(201);
    return expectContract(roomSchema, body);
  };

  const createMember = async (email?: string) => {
    sequence += 1;
    const { status, body } = await api.http
      .post('/api/v1/members')
      .set(auth)
      .send({
        firstName: 'Parallel',
        lastName: `Member ${sequence}`,
        email: email ?? `parallel.${sequence}@example.com`,
        phone: '+380 44 000 00 00',
        company: '',
        plan: 'flex',
        status: 'active',
      });
    expect(status).toBe(201);
    return expectContract(memberSchema, body);
  };

  const book = (roomId: string, memberId: string, from: string, to: string) =>
    api.http
      .post('/api/v1/bookings')
      .set(auth)
      .send({ roomId, memberId, ...slot(from, to), attendees: 2, notes: null });

  it('gives one of several bookings of the same slot the room', async () => {
    const room = await createRoom((await createLocation()).id);
    const members = await Promise.all(Array.from({ length: PARALLEL }, () => createMember()));

    const answers = await Promise.all(members.map((m) => book(room.id, m.id, '10:00', '12:00')));

    expect(tally(answers.map((a) => a.status))).toEqual({ 201: 1, 409: PARALLEL - 1 });
    const winner = expectContract(bookingSchema, answers.find((a) => a.status === 201)?.body);
    for (const answer of answers.filter((a) => a.status === 409)) {
      expect(answer.body).toMatchObject({
        message: 'The room is already booked for this time',
        conflicts: [{ id: winner.id }],
      });
    }
    const list = await api.http.get('/api/v1/bookings').query({ roomId: room.id }).set(auth);
    expect((list.body as { total: number }).total).toBe(1);
  });

  it('books touching slots of one room side by side', async () => {
    const room = await createRoom((await createLocation()).id);
    const members = await Promise.all(Array.from({ length: 4 }, () => createMember()));
    const answers = await Promise.all(
      members.map((m, i) => book(room.id, m.id, hour(8 + i), hour(9 + i))),
    );

    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201]);
  });

  it('lets one member hold several rooms at the same time, as the mock does', async () => {
    const location = await createLocation();
    const rooms = await Promise.all(Array.from({ length: 4 }, () => createRoom(location.id)));
    const member = await createMember();

    const answers = await Promise.all(rooms.map((r) => book(r.id, member.id, '13:00', '14:00')));

    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201]);
  });

  it('registers one of several members with the same email', async () => {
    const emails = [
      'Same.Person@example.com',
      'same.person@example.com',
      'SAME.PERSON@EXAMPLE.COM',
    ];

    const answers = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        api.http
          .post('/api/v1/members')
          .set(auth)
          .send({
            firstName: 'Same',
            lastName: 'Person',
            email: emails[i % emails.length],
            phone: '+380 44 000 00 00',
            company: '',
            plan: 'flex',
            status: 'active',
          }),
      ),
    );

    expect(tally(answers.map((a) => a.status))).toEqual({ 201: 1, 422: PARALLEL - 1 });
    for (const answer of answers.filter((a) => a.status === 422)) {
      expect(answer.body).toEqual({
        message: 'Validation failed',
        fieldErrors: { email: 'This email is already registered' },
      });
    }
  });

  it('gives every entity created at the same time its own id', async () => {
    const answers = await Promise.all([
      ...Array.from({ length: PARALLEL }, () => createLocation()),
      ...Array.from({ length: PARALLEL }, () => createMember()),
    ]);

    const ids = answers.map((entity) => entity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lets a cancellation win against a confirmation of the same booking', async () => {
    const room = await createRoom((await createLocation()).id);
    const member = await createMember();
    const booking = expectContract(
      bookingSchema,
      (await book(room.id, member.id, '15:00', '16:00')).body,
    );
    const change = (status: string) =>
      api.http.post(`/api/v1/bookings/${booking.id}/status`).set(auth).send({ status });

    const [confirm, cancel] = await Promise.all([change('confirmed'), change('cancelled')]);

    // Confirming first leaves the cancellation allowed, cancelling first makes the confirmation
    // a refused transition: both orders end in a cancelled booking.
    expect([
      [200, 200],
      [409, 200],
    ]).toContainEqual([confirm.status, cancel.status]);
    expect(confirm.body).toMatchObject(
      confirm.status === 200
        ? { id: booking.id }
        : { message: 'Cannot change status from cancelled to confirmed' },
    );
    const after = await api.http.get(`/api/v1/bookings/${booking.id}`).set(auth);
    expect((after.body as Booking).status).toBe('cancelled');
  });

  it('answers a bulk confirmation and a cancellation of the same bookings in one of the two orders', async () => {
    const room = await createRoom((await createLocation()).id);
    const members = await Promise.all(Array.from({ length: 3 }, () => createMember()));
    const bookings = await Promise.all(
      members.map(async (m, i) =>
        expectContract(
          bookingSchema,
          (
            await book(
              room.id,
              m.id,
              `${String(8 + i)}:00`.padStart(5, '0'),
              `${String(9 + i)}:00`.padStart(5, '0'),
            )
          ).body,
        ),
      ),
    );
    const ids = bookings.map((b) => b.id);
    const bulk = (action: 'confirm' | 'cancel') =>
      api.http.post('/api/v1/bookings/bulk').set(auth).send({ ids, action });

    const [confirm, cancel] = await Promise.all([bulk('confirm'), bulk('cancel')]);

    expect(confirm.status).toBe(200);
    expect(cancel.status).toBe(200);
    const confirmed = (confirm.body as { updated: string[] }).updated;
    const cancelled = (cancel.body as { updated: string[] }).updated;
    // Every booking was cancelled; it was also confirmed first or its confirmation was refused.
    expect(cancelled).toEqual(ids);
    expect((confirm.body as { failed: { id: string }[] }).failed.map((f) => f.id).sort()).toEqual(
      ids.filter((id) => !confirmed.includes(id)).sort(),
    );
    const list = await api.http.get('/api/v1/bookings').query({ roomId: room.id }).set(auth);
    expect((list.body as { items: Booking[] }).items.map((b) => b.status)).toEqual(
      ids.map(() => 'cancelled'),
    );
  });

  it('never leaves a booking in a room that is being deleted', async () => {
    const room = await createRoom((await createLocation()).id);
    const member = await createMember();

    const [booked, deleted] = await Promise.all([
      book(room.id, member.id, '17:00', '18:00'),
      api.http.delete(`/api/v1/rooms/${room.id}`).set(auth),
    ]);

    // Either the room was removed first and the booking was refused, or the booking came first
    // and the deletion was refused because of it.
    expect([
      [201, 409],
      [422, 204],
    ]).toContainEqual([booked.status, deleted.status]);
    expect(booked.body).toMatchObject(
      booked.status === 201
        ? { roomId: room.id }
        : { message: 'Validation failed', fieldErrors: { roomId: 'Room not found' } },
    );
    const after = await api.http.get(`/api/v1/rooms/${room.id}`).set(auth);
    expect(after.status).toBe(deleted.status === 204 ? 404 : 200);
  });

  it('answers 204 to resets that arrive together and leaves the seeded data', async () => {
    const golden = loadSeedGolden();
    await createRoom((await createLocation()).id);

    const answers = await Promise.all(
      Array.from({ length: 4 }, () => api.http.post('/api/v1/__reset')),
    );

    expect(answers.map((a) => a.status)).toEqual([204, 204, 204, 204]);
    const locations = await api.http.get('/api/v1/locations').set(auth);
    expect((locations.body as { total: number }).total).toBe(golden.counts.locations);
    const bookings = await api.http.get('/api/v1/bookings').query({ limit: '1' }).set(auth);
    expect((bookings.body as { total: number }).total).toBe(golden.counts.bookings);
  });
});
