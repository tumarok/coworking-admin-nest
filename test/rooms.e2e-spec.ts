import { sequenceOf } from '../src/common/ids/ids.js';
import { roomPageSchema, roomSchema } from '../src/contract/index.js';
import { nextEntityId } from '../src/database/entity-id.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { BookingStatus } from '../src/generated/prisma/enums.js';
import { SEED_NOW } from './support/constants.js';
import { expectContract } from './support/expect-contract.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

const BASE = '/api/v1/rooms';
const HOUR = 3_600_000;

const newRoom = {
  locationId: 'loc_1',
  name: 'Onyx',
  type: 'meeting_room',
  capacity: 6,
  hourlyRate: 2500,
  amenities: ['projector', 'whiteboard'],
  status: 'available',
};

// The seeded rooms in list order (location name, then name): [id, location, name].
const SORTED = [
  ['room_u', 'Canal Yard', 'Cedar'],
  ['room_q', 'Canal Yard', 'Ember'],
  ['room_r', 'Canal Yard', 'Fjord'],
  ['room_s', 'Canal Yard', 'Iris'],
  ['room_t', 'Canal Yard', 'Juniper'],
  ['room_p', 'Canal Yard', 'Kestrel'],
  ['room_11', 'Harbour Studio', 'Birch'],
  ['room_y', 'Harbour Studio', 'Delta'],
  ['room_z', 'Harbour Studio', 'Ember'],
  ['room_x', 'Harbour Studio', 'Granite'],
  ['room_w', 'Harbour Studio', 'Iris'],
  ['room_v', 'Harbour Studio', 'Juniper'],
  ['room_10', 'Harbour Studio', 'Kestrel'],
] as const;

const ROOM_TYPE_ERROR =
  'Invalid option: expected one of "meeting_room"|"private_office"|"hot_desk"|"event_space"';
const ROOM_STATUS_ERROR = 'Invalid option: expected one of "available"|"maintenance"|"retired"';

describe('rooms (read)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;

  const list = async (query = '') => {
    const { status, body } = await api.http.get(`${BASE}${query}`).set(auth);
    expect(status).toBe(200);
    return expectContract(roomPageSchema, body);
  };
  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);
  const labels = (page: { items: { locationName: string; name: string }[] }) =>
    page.items.map((item) => `${item.locationName}/${item.name}`);

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
      ['GET', `${BASE}/room_6`],
      ['POST', BASE],
      ['PATCH', `${BASE}/room_6`],
      ['DELETE', `${BASE}/room_6`],
    ] as const)('answers %s %s with 401 without a token', async (method, path) => {
      const { status, body } = await api.http[method.toLowerCase() as 'get'](path);

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });
  });

  describe('GET /rooms', () => {
    it('lists the 32 rooms by location name and then name', async () => {
      const page = await list('?limit=100');

      expect(page).toMatchObject({ total: 32, page: 1, limit: 100 });
      expect(page.items).toHaveLength(32);
      expect(page.items.slice(0, SORTED.length).map((r) => [r.id, r.locationName, r.name])).toEqual(
        SORTED.map((row) => [...row]),
      );
    });

    it('returns the first 20 by default', async () => {
      const page = await list();

      expect(page).toMatchObject({ total: 32, page: 1, limit: 20 });
      expect(page.items).toHaveLength(20);
    });

    it('returns the fields of the seeded record', async () => {
      const { items } = await list('?q=granite&locationId=loc_1');

      expect(items).toEqual([
        {
          id: 'room_6',
          locationId: 'loc_1',
          locationName: 'Riverside Hub',
          name: 'Granite',
          type: 'hot_desk',
          capacity: 35,
          hourlyRate: 650,
          amenities: ['whiteboard'],
          status: 'available',
        },
      ]);
    });

    it('keeps the order of the amenities as stored', async () => {
      const { items } = await list('?q=cedar&locationId=loc_4');

      expect(items[0]?.amenities).toEqual([
        'whiteboard',
        'video_conferencing',
        'natural_light',
        'phone',
      ]);
    });

    it('pages the sorted list', async () => {
      const second = await list('?page=2&limit=5');

      expect(labels(second)).toEqual([
        'Canal Yard/Kestrel',
        'Harbour Studio/Birch',
        'Harbour Studio/Delta',
        'Harbour Studio/Ember',
        'Harbour Studio/Granite',
      ]);
      expect(second).toMatchObject({ total: 32, page: 2, limit: 5 });
    });

    it('answers a page beyond the last with no items and the total', async () => {
      expect(await list('?page=99')).toEqual({ items: [], total: 32, page: 99, limit: 20 });
    });

    it('answers the last page with the rest', async () => {
      const page = await list('?page=2&limit=20');

      expect(page.items).toHaveLength(12);
    });

    it.each([
      ['loc_1', 7, 'Riverside Hub'],
      ['loc_2', 7, 'Market Square Loft'],
      ['loc_3', 5, 'Old Mill Works'],
      ['loc_4', 6, 'Canal Yard'],
      ['loc_5', 7, 'Harbour Studio'],
    ])('filters by location %s', async (locationId, total, name) => {
      const page = await list(`?locationId=${locationId}&limit=100`);

      expect(page.total).toBe(total);
      expect(new Set(page.items.map((item) => item.locationName))).toEqual(new Set([name]));
    });

    it('matches the whole location id, not a part of it', async () => {
      expect((await list('?locationId=loc')).total).toBe(0);
      expect((await list('?locationId=LOC_1')).total).toBe(0);
    });

    it.each([
      ['meeting_room', 14],
      ['private_office', 6],
      ['hot_desk', 5],
      ['event_space', 7],
    ])('filters by type %s', async (type, total) => {
      const page = await list(`?type=${type}&limit=100`);

      expect(page.total).toBe(total);
      expect(page.items.every((item) => item.type === type)).toBe(true);
    });

    it.each([
      ['available', 26],
      ['maintenance', 5],
      ['retired', 1],
    ])('filters by status %s', async (status, total) => {
      const page = await list(`?status=${status}&limit=100`);

      expect(page.total).toBe(total);
      expect(page.items.every((item) => item.status === status)).toBe(true);
    });

    it('filters by minimum capacity, which counts the room that seats exactly that many', async () => {
      expect(ids(await list('?minCapacity=103&limit=100')).sort()).toEqual([
        'room_9',
        'room_i',
        'room_y',
        'room_z',
      ]);
      expect((await list('?minCapacity=40')).total).toBe(8);
      expect((await list('?minCapacity=1')).total).toBe(32);
      expect((await list('?minCapacity=999')).total).toBe(0);
    });

    it.each([
      ['the name', '?q=juniper', 5],
      ['the name, whatever the case', '?q=KESTREL', 3],
      ['the location name', '?q=riverside', 7],
      ['a trimmed text', '?q=%20%20hub%20', 7],
      ['a name and a location together', '?q=yard', 6],
      ['nothing, when it is empty', '?q=', 32],
      ['nothing, when it is blank', '?q=%20%20', 32],
      ['no one, when nothing contains it', '?q=zzz', 0],
      ['% as a plain character', '?q=%25', 0],
      ['_ as a plain character', '?q=_', 0],
    ])('searches %s', async (_what, query, total) => {
      expect((await list(query)).total).toBe(total);
    });

    it('does not search the type or the amenities', async () => {
      expect((await list('?q=hot_desk')).total).toBe(0);
      expect((await list('?q=projector')).total).toBe(0);
    });

    it('orders the matches of a search like the whole list', async () => {
      expect(labels(await list('?q=kestrel'))).toEqual([
        'Canal Yard/Kestrel',
        'Harbour Studio/Kestrel',
        'Market Square Loft/Kestrel',
      ]);
    });

    it('combines the filters with the search and the paging', async () => {
      const page = await list('?status=maintenance&q=yard');

      expect(labels(page)).toEqual(['Canal Yard/Kestrel']);

      const paged = await list('?type=meeting_room&status=available&minCapacity=8&limit=2&page=2');
      expect(paged).toMatchObject({ total: 7, page: 2, limit: 2 });
      expect(labels(paged)).toEqual(['Harbour Studio/Birch', 'Harbour Studio/Granite']);
    });

    it('treats an empty filter as no filter', async () => {
      expect((await list('?locationId=&type=&status=&minCapacity=')).total).toBe(32);
    });

    it('keeps the last of a repeated key', async () => {
      expect((await list('?status=retired&status=available')).total).toBe(26);
      expect((await list('?minCapacity=999&minCapacity=100')).total).toBe(4);
    });

    it('ignores unknown keys', async () => {
      expect((await list('?sort=name&foo=bar')).total).toBe(32);
    });

    it.each([
      ['limit=abc', { limit: 'Invalid input: expected number, received NaN' }],
      ['limit=0', { limit: 'Too small: expected number to be >=1' }],
      ['limit=101', { limit: 'Too big: expected number to be <=100' }],
      ['page=0', { page: 'Too small: expected number to be >=1' }],
      ['page=1.5', { page: 'Invalid input: expected int, received number' }],
      ['minCapacity=abc', { minCapacity: 'Invalid input: expected number, received NaN' }],
      ['minCapacity=0', { minCapacity: 'Too small: expected number to be >=1' }],
      ['minCapacity=-3', { minCapacity: 'Too small: expected number to be >=1' }],
      ['minCapacity=2.5', { minCapacity: 'Invalid input: expected int, received number' }],
      ['type=desk', { type: ROOM_TYPE_ERROR }],
      ['status=closed', { status: ROOM_STATUS_ERROR }],
      [
        'limit=abc&minCapacity=abc&type=desk',
        {
          limit: 'Invalid input: expected number, received NaN',
          minCapacity: 'Invalid input: expected number, received NaN',
          type: ROOM_TYPE_ERROR,
        },
      ],
    ])('rejects ?%s with 422', async (query, fieldErrors) => {
      const { status, body } = await api.http.get(`${BASE}?${query}`).set(auth);

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors });
    });
  });

  describe('GET /rooms/:id', () => {
    it('returns the room', async () => {
      const { status, body } = await api.http.get(`${BASE}/room_k`).set(auth);

      expect(status).toBe(200);
      expect(expectContract(roomSchema, body)).toEqual({
        id: 'room_k',
        locationId: 'loc_3',
        locationName: 'Old Mill Works',
        name: 'Granite',
        type: 'hot_desk',
        capacity: 40,
        hourlyRate: 1200,
        amenities: ['whiteboard', 'video_conferencing'],
        status: 'available',
      });
    });

    it('answers a trailing slash', async () => {
      expect((await api.http.get(`${BASE}/room_k/`).set(auth)).status).toBe(200);
    });

    it('answers 404 for an unknown id', async () => {
      const { status, body } = await api.http.get(`${BASE}/room_missing`).set(auth);

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Room not found' });
    });
  });
});

describe('rooms (write)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let prisma: PrismaService;

  const create = async (input: object = newRoom) => {
    const { status, body } = await api.http.post(BASE).set(auth).send(input);
    expect(status).toBe(201);
    return expectContract(roomSchema, body);
  };
  const get = (id: string) => api.http.get(`${BASE}/${id}`).set(auth);
  const remove = (id: string) => api.http.delete(`${BASE}/${id}`).set(auth);
  const patch = (id: string, input: object) =>
    api.http.patch(`${BASE}/${id}`).set(auth).send(input);

  const createLocation = async () => {
    const { status, body } = await api.http.post('/api/v1/locations').set(auth).send({
      name: 'Garden Court',
      city: 'Warsaw',
      address: '5 Zielona St',
      timezone: 'Europe/Warsaw',
      opensAt: '08:00',
      closesAt: '20:00',
      status: 'active',
    });
    expect(status).toBe(201);
    return (body as { id: string }).id;
  };
  const roomCount = async (locationId: string) =>
    (
      (await api.http.get(`/api/v1/locations/${locationId}`).set(auth)).body as {
        roomCount: number;
      }
    ).roomCount;

  /** A booking straight in the table: bookings have no endpoint yet. */
  const addBooking = async (
    roomId: string,
    status: BookingStatus,
    startsAt: Date,
    endsAt: Date,
  ) => {
    const { id, seq } = await nextEntityId(prisma.client, 'bk');
    await prisma.client.booking.create({
      data: {
        id,
        seq,
        roomId,
        memberId: 'mem_12',
        startsAt,
        endsAt,
        attendees: 1,
        status,
        notes: null,
        totalPrice: 0,
        createdAt: SEED_NOW,
      },
    });
  };
  const at = (hours: number) => new Date(SEED_NOW.getTime() + hours * HOUR);

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
    prisma = api.app.get(PrismaService);
  });

  afterAll(async () => {
    await api.close();
  });

  describe('POST /rooms', () => {
    it('creates a room with 201 and the name of its location', async () => {
      const room = await create();

      expect(room).toEqual({
        id: expect.stringMatching(/^room_[0-9a-z]+$/),
        ...newRoom,
        locationName: 'Riverside Hub',
      });
      expect((await get(room.id)).body).toEqual(room);
    });

    it('gives the next id of the counter every entity shares', async () => {
      const first = await create();
      const second = await create();

      expect(sequenceOf(first.id)).toBeGreaterThan(1411);
      expect(sequenceOf(second.id)).toBe(sequenceOf(first.id) + 1);
    });

    it('trims the name and keeps the amenities in the order sent', async () => {
      const room = await create({
        ...newRoom,
        name: '  Padded Room  ',
        amenities: ['whiteboard', 'phone', 'projector'],
      });

      expect(room.name).toBe('Padded Room');
      expect(room.amenities).toEqual(['whiteboard', 'phone', 'projector']);
    });

    it('accepts a room without amenities and the limits of the contract', async () => {
      const room = await create({ ...newRoom, amenities: [], capacity: 200, hourlyRate: 0 });

      expect(room).toMatchObject({ amenities: [], capacity: 200, hourlyRate: 0 });
      expect(await create({ ...newRoom, capacity: 1, hourlyRate: 1_000_000 })).toMatchObject({
        capacity: 1,
        hourlyRate: 1_000_000,
      });
    });

    it('ignores the keys the contract does not know', async () => {
      const room = await create({
        ...newRoom,
        id: 'room_mine',
        locationName: 'Elsewhere',
        extra: 1,
      });

      expect(room.id).not.toBe('room_mine');
      expect(room.locationName).toBe('Riverside Hub');
    });

    it('counts the room in its location and lists it in order', async () => {
      const locationId = await createLocation();
      expect(await roomCount(locationId)).toBe(0);

      const { id } = await create({ ...newRoom, locationId, name: 'First' });

      expect(await roomCount(locationId)).toBe(1);
      const { body } = await api.http.get(`${BASE}?locationId=${locationId}`).set(auth);
      expect((body.items as { id: string }[]).map((item) => item.id)).toEqual([id]);
    });

    it('answers 422 with a message for every field an empty-handed request misses', async () => {
      const { status, body } = await api.http.post(BASE).set(auth).send({ name: 'X' });

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          locationId: 'Invalid input: expected string, received undefined',
          name: 'At least 2 characters',
          type: ROOM_TYPE_ERROR,
          capacity: 'Invalid input: expected number, received undefined',
          hourlyRate: 'Invalid input: expected number, received undefined',
          amenities: 'Invalid input: expected array, received undefined',
          status: ROOM_STATUS_ERROR,
        },
      });
    });

    it('answers 422 when the body is not JSON', async () => {
      const { status, body } = await api.http.post(BASE).set(auth).send('{broken');

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ _: 'Invalid input: expected object, received undefined' });
    });

    it.each([
      ['locationId', { locationId: '' }, 'Too small: expected string to have >=1 characters'],
      ['name', { name: 'x'.repeat(61) }, 'Too big: expected string to have <=60 characters'],
      ['name', { name: ' a ' }, 'At least 2 characters'],
      ['type', { type: 'desk' }, ROOM_TYPE_ERROR],
      ['capacity', { capacity: 0 }, 'At least 1 seat'],
      ['capacity', { capacity: 201 }, 'Too big: expected number to be <=200'],
      ['capacity', { capacity: 1.5 }, 'Invalid input: expected int, received number'],
      ['capacity', { capacity: '6' }, 'Invalid input: expected number, received string'],
      ['hourlyRate', { hourlyRate: -1 }, 'Cannot be negative'],
      ['hourlyRate', { hourlyRate: 1_000_001 }, 'Too big: expected number to be <=1000000'],
      ['amenities', { amenities: 'projector' }, 'Invalid input: expected array, received string'],
      ['amenities.1', { amenities: ['phone', 'wifi'] }, expect.stringContaining('Invalid option')],
      ['status', { status: 'closed' }, ROOM_STATUS_ERROR],
    ])('answers 422 for a bad %s', async (field, change, message) => {
      const { status, body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newRoom, ...change });

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: { [field]: message } });
    });

    it('answers 422 for a location that does not exist', async () => {
      const { status, body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newRoom, locationId: 'loc_missing' });

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { locationId: 'Location not found' },
      });
    });

    it('answers 422 for a deleted location and creates nothing', async () => {
      const locationId = await createLocation();
      await api.http.delete(`/api/v1/locations/${locationId}`).set(auth);
      const before = (await api.http.get(`${BASE}?limit=100`).set(auth)).body.total;

      const { status, body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newRoom, locationId });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ locationId: 'Location not found' });
      expect((await api.http.get(`${BASE}?limit=100`).set(auth)).body.total).toBe(before);
    });

    it('reports the schema errors only, when the location is missing too', async () => {
      const { body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newRoom, locationId: 'loc_missing', capacity: 0 });

      expect(body.fieldErrors).toEqual({ capacity: 'At least 1 seat' });
    });

    it('answers 422 when the location is deleted while the room is being created', async () => {
      const locationId = await createLocation();
      let creation: Promise<{ status: number; body: unknown }> | undefined;

      await prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} FOR UPDATE`;
        await tx.location.update({ where: { id: locationId }, data: { deletedAt: SEED_NOW } });
        // The request starts while the delete is not committed yet; it has to queue behind it.
        creation = api.http
          .post(BASE)
          .set(auth)
          .send({ ...newRoom, locationId })
          .then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const { status, body } = (await creation) ?? { status: 0, body: undefined };
      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { locationId: 'Location not found' },
      });
    });
  });

  describe('a room of a deleted location', () => {
    it('shows a dash for the location name, in the room and in the list', async () => {
      const locationId = await createLocation();
      const { id } = await create({ ...newRoom, locationId });
      await prisma.client.location.update({
        where: { id: locationId },
        data: { deletedAt: SEED_NOW },
      });

      const room = expectContract(roomSchema, (await get(id)).body);
      const page = await api.http.get(`${BASE}?q=%E2%80%94`).set(auth);

      expect(room).toMatchObject({ id, locationId, locationName: '—' });
      expect((page.body.items as { id: string }[]).map((item) => item.id)).toContain(id);
    });
  });

  describe('PATCH /rooms/:id', () => {
    it('replaces every field and moves the room to another location', async () => {
      const { id } = await create();
      const replacement = {
        locationId: 'loc_2',
        name: 'Onyx Annex',
        type: 'private_office',
        capacity: 3,
        hourlyRate: 0,
        amenities: [],
        status: 'maintenance',
      };

      const { status, body } = await patch(id, replacement);

      expect(status).toBe(200);
      expect(expectContract(roomSchema, body)).toEqual({
        id,
        ...replacement,
        locationName: 'Market Square Loft',
      });
      expect((await get(id)).body).toEqual(body);
    });

    it('moves the room count from one location to the other', async () => {
      const from = await createLocation();
      const to = await createLocation();
      const { id } = await create({ ...newRoom, locationId: from });

      await patch(id, { ...newRoom, locationId: to });

      expect(await roomCount(from)).toBe(0);
      expect(await roomCount(to)).toBe(1);
    });

    it('keeps the id and the place in the order of creation for equal names', async () => {
      const locationId = await createLocation();
      const first = await create({ ...newRoom, locationId, name: 'Twin' });
      const second = await create({ ...newRoom, locationId, name: 'Twin' });

      await patch(first.id, { ...newRoom, locationId, name: 'Twin', capacity: 9 });

      const { body } = await api.http.get(`${BASE}?locationId=${locationId}`).set(auth);
      expect((body.items as { id: string }[]).map((item) => item.id)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it('ignores the keys the contract does not know', async () => {
      const room = await create();

      const { body } = await patch(room.id, { ...newRoom, id: 'room_other', locationName: 'X' });

      expect(body).toEqual(room);
    });

    it('answers 404 for an unknown id, even when the body is invalid', async () => {
      const { status, body } = await patch('room_missing', { name: 'X' });

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Room not found' });
    });

    it('answers 404 for a deleted room', async () => {
      const { id } = await create();
      await remove(id);

      expect((await patch(id, newRoom)).status).toBe(404);
    });

    it('answers 422 and changes nothing for a partial body', async () => {
      const room = await create();

      const { status, body } = await patch(room.id, { name: 'Renamed' });

      expect(status).toBe(422);
      expect(Object.keys(body.fieldErrors as object)).toEqual([
        'locationId',
        'type',
        'capacity',
        'hourlyRate',
        'amenities',
        'status',
      ]);
      expect((await get(room.id)).body).toEqual(room);
    });

    it('answers 422 for a bad field', async () => {
      const { id } = await create();

      const { status, body } = await patch(id, { ...newRoom, capacity: 0 });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ capacity: 'At least 1 seat' });
    });

    it.each(['loc_missing', 'deleted'])(
      'answers 422 for a location that is %s and leaves the room where it was',
      async (target) => {
        const room = await create();
        let locationId = target;
        if (target === 'deleted') {
          locationId = await createLocation();
          await api.http.delete(`/api/v1/locations/${locationId}`).set(auth);
        }

        const { status, body } = await patch(room.id, { ...newRoom, name: 'Moved', locationId });

        expect(status).toBe(422);
        expect(body).toEqual({
          message: 'Validation failed',
          fieldErrors: { locationId: 'Location not found' },
        });
        expect((await get(room.id)).body).toEqual(room);
      },
    );

    it('answers 422 when the target location is deleted while the room is being saved', async () => {
      const { id } = await create();
      const locationId = await createLocation();
      let saving: Promise<{ status: number; body: unknown }> | undefined;

      await prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} FOR UPDATE`;
        await tx.location.update({ where: { id: locationId }, data: { deletedAt: SEED_NOW } });
        // The request starts while the delete is not committed yet; it has to queue behind it.
        saving = patch(id, { ...newRoom, locationId }).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const { status, body } = (await saving) ?? { status: 0, body: undefined };
      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: { locationId: 'Location not found' },
      });
      expect((await get(id)).body).toMatchObject({ locationName: 'Riverside Hub' });
    });

    it('saves a room that has upcoming bookings', async () => {
      const { id } = await create();
      await addBooking(id, 'confirmed', at(1), at(2));

      const { status, body } = await patch(id, { ...newRoom, capacity: 1, status: 'maintenance' });

      expect(status).toBe(200);
      expect(body).toMatchObject({ id, capacity: 1, status: 'maintenance' });
    });

    it('lets a room of a deleted location be saved in place only once it moves', async () => {
      const locationId = await createLocation();
      const { id } = await create({ ...newRoom, locationId });
      await prisma.client.location.update({
        where: { id: locationId },
        data: { deletedAt: SEED_NOW },
      });

      expect((await patch(id, { ...newRoom, locationId })).status).toBe(422);
      expect((await patch(id, newRoom)).body).toMatchObject({ locationName: 'Riverside Hub' });
    });
  });

  describe('DELETE /rooms/:id', () => {
    it('removes a room without bookings with 204 and no body', async () => {
      const { id } = await create();

      const removed = await remove(id);

      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');
      expect(removed.headers['content-type']).toBeUndefined();
      expect((await get(id)).status).toBe(404);
      const { body } = await api.http.get(`${BASE}?limit=100`).set(auth);
      expect((body.items as { id: string }[]).map((item) => item.id)).not.toContain(id);
    });

    it('keeps the row, marked with the time of the clock', async () => {
      const { id } = await create();
      await remove(id);

      const row = await prisma.client.room.findUnique({ where: { id } });

      expect(row?.deletedAt).toEqual(SEED_NOW);
    });

    it('takes the room out of the count of its location, which can then be deleted', async () => {
      const locationId = await createLocation();
      const { id } = await create({ ...newRoom, locationId });
      expect((await api.http.delete(`/api/v1/locations/${locationId}`).set(auth)).status).toBe(409);

      await remove(id);

      expect(await roomCount(locationId)).toBe(0);
      expect((await api.http.delete(`/api/v1/locations/${locationId}`).set(auth)).status).toBe(204);
    });

    it('answers 404 for an unknown or an already deleted id', async () => {
      const { id } = await create();
      await remove(id);

      for (const target of ['room_missing', id]) {
        const { status, body } = await remove(target);

        expect(status).toBe(404);
        expect(body).toEqual({ message: 'Room not found' });
      }
    });

    it.each(['pending', 'confirmed', 'checked_in'] as const)(
      'answers 409 and keeps the room while a %s booking has not ended',
      async (bookingStatus) => {
        const { id } = await create();
        await addBooking(id, bookingStatus, at(1), at(2));

        const { status, body } = await remove(id);

        expect(status).toBe(409);
        expect(body).toEqual({ message: 'This room has upcoming bookings; cancel them first' });
        expect((await get(id)).status).toBe(200);
      },
    );

    it('answers 409 for a booking that is under way', async () => {
      const { id } = await create();
      await addBooking(id, 'checked_in', at(-1), at(1));

      expect((await remove(id)).status).toBe(409);
    });

    it.each(['pending', 'confirmed', 'checked_in'] as const)(
      'does not count a %s booking that has ended',
      async (bookingStatus) => {
        const { id } = await create();
        await addBooking(id, bookingStatus, at(-3), at(-2));

        expect((await remove(id)).status).toBe(204);
      },
    );

    it('does not count a booking that ends at the very moment of the request', async () => {
      const { id } = await create();
      await addBooking(id, 'confirmed', at(-1), at(0));

      expect((await remove(id)).status).toBe(204);
    });

    it.each(['cancelled', 'completed', 'no_show'] as const)(
      'does not count a %s booking in the future',
      async (bookingStatus) => {
        const { id } = await create();
        await addBooking(id, bookingStatus, at(1), at(2));

        expect((await remove(id)).status).toBe(204);
      },
    );

    it('does not count the upcoming bookings of another room', async () => {
      const busy = await create();
      const { id } = await create();
      await addBooking(busy.id, 'confirmed', at(1), at(2));

      expect((await remove(id)).status).toBe(204);
      expect((await remove(busy.id)).status).toBe(409);
    });

    it('can delete the room again once its upcoming booking is cancelled', async () => {
      const { id } = await create();
      await addBooking(id, 'pending', at(1), at(2));
      expect((await remove(id)).status).toBe(409);

      await prisma.client.booking.updateMany({
        where: { roomId: id },
        data: { status: 'cancelled' },
      });

      expect((await remove(id)).status).toBe(204);
    });

    it('keeps the bookings of a deleted room', async () => {
      const { id } = await create();
      await addBooking(id, 'completed', at(-3), at(-2));
      await remove(id);

      expect(await prisma.client.booking.count({ where: { roomId: id } })).toBe(1);
    });

    it('waits for a booking being added and then refuses to delete', async () => {
      const { id } = await create();
      let removal: Promise<{ status: number; body: unknown }> | undefined;

      await prisma.client.$transaction(async (tx) => {
        const { id: bookingId, seq } = await nextEntityId(tx, 'bk');
        await tx.booking.create({
          data: {
            id: bookingId,
            seq,
            roomId: id,
            memberId: 'mem_12',
            startsAt: at(1),
            endsAt: at(2),
            attendees: 1,
            status: 'confirmed',
            notes: null,
            totalPrice: 0,
            createdAt: SEED_NOW,
          },
        });
        // The delete starts while the booking is not committed yet; it has to queue behind it.
        removal = remove(id).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const { status, body } = (await removal) ?? { status: 0, body: undefined };
      expect(status).toBe(409);
      expect(body).toEqual({ message: 'This room has upcoming bookings; cancel them first' });
      expect((await get(id)).status).toBe(200);
    });

    it('lets one of two simultaneous deletes win', async () => {
      const { id } = await create();

      const results = await Promise.all([remove(id), remove(id)]);

      expect(results.map((result) => result.status).sort()).toEqual([204, 404]);
    });
  });
});
