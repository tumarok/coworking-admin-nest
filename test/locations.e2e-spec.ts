import { sequenceOf } from '../src/common/ids/ids.js';
import { locationPageSchema, locationSchema } from '../src/contract/index.js';
import { nextEntityId } from '../src/database/entity-id.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { RoomStatus } from '../src/generated/prisma/enums.js';
import { SEED_NOW } from './support/constants.js';
import { expectContract } from './support/expect-contract.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

const BASE = '/api/v1/locations';

const newLocation = {
  name: 'Garden Court',
  city: 'Warsaw',
  address: '5 Zielona St',
  timezone: 'Europe/Warsaw',
  opensAt: '08:00',
  closesAt: '20:00',
  status: 'active',
};

// The seeded locations by name, with the rooms each has (every status counts).
const BY_NAME = [
  ['loc_4', 'Canal Yard', 6],
  ['loc_5', 'Harbour Studio', 7],
  ['loc_2', 'Market Square Loft', 7],
  ['loc_3', 'Old Mill Works', 5],
  ['loc_1', 'Riverside Hub', 7],
] as const;

describe('locations (read)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;

  const list = async (query = '') => {
    const { status, body } = await api.http.get(`${BASE}${query}`).set(auth);
    expect(status).toBe(200);
    return expectContract(locationPageSchema, body);
  };
  const names = (page: { items: { name: string }[] }) => page.items.map((item) => item.name);

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
      ['GET', `${BASE}/loc_1`],
      ['POST', BASE],
      ['PATCH', `${BASE}/loc_1`],
      ['DELETE', `${BASE}/loc_1`],
    ] as const)('answers %s %s with 401 without a token', async (method, path) => {
      const { status, body } = await api.http[method.toLowerCase() as 'get'](path);

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });
  });

  describe('GET /locations', () => {
    it('lists the locations by name with the number of their rooms', async () => {
      const page = await list();

      expect(page).toMatchObject({ total: 5, page: 1, limit: 20 });
      expect(page.items.map((item) => [item.id, item.name, item.roomCount])).toEqual(
        BY_NAME.map((row) => [...row]),
      );
    });

    it('returns the fields of the seeded record', async () => {
      const { items } = await list('?q=riverside');

      expect(items).toEqual([
        {
          id: 'loc_1',
          name: 'Riverside Hub',
          city: 'Kyiv',
          address: '12 Naberezhna St',
          timezone: 'Europe/Kyiv',
          opensAt: '08:00',
          closesAt: '21:00',
          status: 'active',
          roomCount: 7,
        },
      ]);
    });

    it('pages the sorted list', async () => {
      const second = await list('?page=2&limit=2');

      expect(names(second)).toEqual(['Market Square Loft', 'Old Mill Works']);
      expect(second).toMatchObject({ total: 5, page: 2, limit: 2 });
    });

    it('answers a page beyond the last with no items and the total', async () => {
      expect(await list('?page=99')).toEqual({ items: [], total: 5, page: 99, limit: 20 });
    });

    it.each([
      ['the name', '?q=canal', ['Canal Yard']],
      ['the city, whatever the case', '?q=LVIV', ['Market Square Loft']],
      ['the address', '?q=rua%20do', ['Harbour Studio']],
      ['a trimmed text', '?q=%20%20mill%20', ['Old Mill Works']],
      ['an accented letter', '?q=krak%C3%B3w', ['Old Mill Works']],
      ['nothing, when it is empty', '?q=', BY_NAME.map(([, name]) => name)],
      ['nothing, when it is blank', '?q=%20%20', BY_NAME.map(([, name]) => name)],
      ['no one, when nothing contains it', '?q=zzz', []],
      ['% as a plain character', '?q=%25', []],
      ['_ as a plain character', '?q=_', []],
    ])('searches %s', async (_what, query, expected) => {
      expect(names(await list(query))).toEqual(expected);
    });

    it('filters by city, whatever the case', async () => {
      expect(names(await list('?city=kyiv'))).toEqual(['Riverside Hub']);
      expect(names(await list('?city=BERLIN'))).toEqual(['Canal Yard']);
    });

    it('matches the whole city, not a part of it', async () => {
      expect(await list('?city=Kyi')).toMatchObject({ items: [], total: 0 });
    });

    it('filters by status', async () => {
      expect(names(await list('?status=inactive'))).toEqual(['Harbour Studio']);
      expect((await list('?status=active')).total).toBe(4);
    });

    it('combines the filters with the search and the paging', async () => {
      // "ar" is in Canal Yard, Market Square Loft and the inactive Harbour Studio.
      const page = await list('?status=active&q=ar&limit=1&page=2');

      expect(page).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(names(page)).toEqual(['Market Square Loft']);
    });

    it('treats an empty filter as no filter', async () => {
      expect((await list('?status=&city=')).total).toBe(5);
    });

    it('keeps the last of a repeated key', async () => {
      expect((await list('?status=inactive&status=active')).total).toBe(4);
    });

    it('ignores unknown keys', async () => {
      expect((await list('?sort=name&foo=bar')).total).toBe(5);
    });

    it.each([
      ['limit=abc', { limit: 'Invalid input: expected number, received NaN' }],
      ['limit=0', { limit: 'Too small: expected number to be >=1' }],
      ['limit=101', { limit: 'Too big: expected number to be <=100' }],
      ['page=0', { page: 'Too small: expected number to be >=1' }],
      ['page=1.5', { page: 'Invalid input: expected int, received number' }],
      ['status=closed', { status: 'Invalid option: expected one of "active"|"inactive"' }],
      [
        'limit=abc&status=closed',
        {
          limit: 'Invalid input: expected number, received NaN',
          status: 'Invalid option: expected one of "active"|"inactive"',
        },
      ],
    ])('rejects ?%s with 422', async (query, fieldErrors) => {
      const { status, body } = await api.http.get(`${BASE}?${query}`).set(auth);

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors });
    });
  });

  describe('GET /locations/:id', () => {
    it('returns the location', async () => {
      const { status, body } = await api.http.get(`${BASE}/loc_3`).set(auth);

      expect(status).toBe(200);
      expect(expectContract(locationSchema, body)).toMatchObject({
        id: 'loc_3',
        name: 'Old Mill Works',
        city: 'Kraków',
        timezone: 'Europe/Warsaw',
        opensAt: '07:30',
        roomCount: 5,
      });
    });

    it('answers a trailing slash', async () => {
      expect((await api.http.get(`${BASE}/loc_3/`).set(auth)).status).toBe(200);
    });

    it('answers 404 for an unknown id', async () => {
      const { status, body } = await api.http.get(`${BASE}/loc_missing`).set(auth);

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Location not found' });
    });
  });
});

describe('locations (write)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let prisma: PrismaService;

  const create = async (input: object = newLocation) => {
    const { status, body } = await api.http.post(BASE).set(auth).send(input);
    expect(status).toBe(201);
    return expectContract(locationSchema, body);
  };
  const get = (id: string) => api.http.get(`${BASE}/${id}`).set(auth);

  /** A room written straight into the table. */
  const addRoom = async (
    locationId: string,
    {
      status = 'available',
      deletedAt = null,
    }: { status?: RoomStatus; deletedAt?: Date | null } = {},
  ) => {
    const { id, seq } = await nextEntityId(prisma.client, 'room');
    await prisma.client.room.create({
      data: {
        id,
        seq,
        locationId,
        name: `Room ${id}`,
        type: 'hot_desk',
        capacity: 1,
        hourlyRate: 1000,
        amenities: [],
        status,
        deletedAt,
      },
    });
  };

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
    prisma = api.app.get(PrismaService);
  });

  afterAll(async () => {
    await api.close();
  });

  describe('POST /locations', () => {
    it('creates a location with 201 and no rooms', async () => {
      const location = await create();

      expect(location).toEqual({
        id: expect.stringMatching(/^loc_[0-9a-z]+$/),
        ...newLocation,
        roomCount: 0,
      });
      expect((await get(location.id)).body).toEqual(location);
    });

    it('gives the next id of the counter every entity shares', async () => {
      const first = await create();
      const second = await create();

      expect(sequenceOf(second.id)).toBe(sequenceOf(first.id) + 1);
    });

    it('trims the text fields', async () => {
      const location = await create({
        ...newLocation,
        name: '  Padded Hub  ',
        city: ' Oslo ',
        address: ' 1 Long Street ',
      });

      expect(location).toMatchObject({
        name: 'Padded Hub',
        city: 'Oslo',
        address: '1 Long Street',
      });
    });

    it('ignores the keys the contract does not know', async () => {
      const location = await create({ ...newLocation, id: 'loc_mine', roomCount: 99, extra: 1 });

      expect(location.id).not.toBe('loc_mine');
      expect(location.roomCount).toBe(0);
    });

    it('lists the new location in the name order', async () => {
      const { name } = await create({ ...newLocation, name: 'Aardvark Annex' });
      const { body } = await api.http.get(`${BASE}?limit=100`).set(auth);

      expect(body.items[0].name).toBe(name);
    });

    it('answers 422 with a message for every field an empty-handed request misses', async () => {
      const { status, body } = await api.http.post(BASE).set(auth).send({ name: 'X' });

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          name: 'At least 2 characters',
          city: 'Invalid input: expected string, received undefined',
          address: 'Invalid input: expected string, received undefined',
          timezone:
            'Invalid option: expected one of "Europe/Kyiv"|"Europe/Warsaw"|"Europe/Berlin"|"Europe/Lisbon"|"Europe/London"',
          opensAt: 'Invalid input: expected string, received undefined',
          closesAt: 'Invalid input: expected string, received undefined',
          status: 'Invalid option: expected one of "active"|"inactive"',
        },
      });
    });

    it('answers 422 when the body is not JSON', async () => {
      const { status, body } = await api.http.post(BASE).set(auth).send('{broken');

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ _: 'Invalid input: expected object, received undefined' });
    });

    it('answers 422 for a closing time that is not after the opening time', async () => {
      const { status, body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newLocation, opensAt: '09:00', closesAt: '09:00' });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ closesAt: 'Closing time must be after opening time' });
    });

    it('does not compare the times while one of them is missing', async () => {
      const { body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newLocation, opensAt: undefined, closesAt: '07:00' });

      expect(body.fieldErrors).toEqual({
        opensAt: 'Invalid input: expected string, received undefined',
      });
    });

    it('compares the times even when one has the wrong format, as the mock does', async () => {
      const { body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newLocation, opensAt: '25:00', closesAt: '07:00' });

      expect(body.fieldErrors).toEqual({
        opensAt: 'Use the HH:mm format',
        closesAt: 'Closing time must be after opening time',
      });
    });

    it.each([
      ['name', { name: 'x'.repeat(81) }, 'Too big: expected string to have <=80 characters'],
      ['city', { city: ' a ' }, 'At least 2 characters'],
      ['address', { address: 'abcd' }, 'At least 5 characters'],
      ['timezone', { timezone: 'Asia/Tokyo' }, expect.stringContaining('Invalid option')],
    ])('answers 422 for a bad %s', async (field, change, message) => {
      const { status, body } = await api.http
        .post(BASE)
        .set(auth)
        .send({ ...newLocation, ...change });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ [field]: message });
    });
  });

  describe('PATCH /locations/:id', () => {
    it('replaces every field and keeps the room count', async () => {
      const replacement = {
        name: 'Riverside Annex',
        city: 'Odesa',
        address: '7 Deribasivska St',
        timezone: 'Europe/Kyiv',
        opensAt: '09:00',
        closesAt: '18:00',
        status: 'inactive',
      };

      const { status, body } = await api.http.patch(`${BASE}/loc_1`).set(auth).send(replacement);

      expect(status).toBe(200);
      expect(expectContract(locationSchema, body)).toEqual({
        id: 'loc_1',
        ...replacement,
        roomCount: 7,
      });
      expect((await get('loc_1')).body).toEqual(body);
    });

    it('ignores the keys the contract does not know', async () => {
      const { id } = await create();

      const { body } = await api.http
        .patch(`${BASE}/${id}`)
        .set(auth)
        .send({ ...newLocation, id: 'loc_other', roomCount: 5 });

      expect(body).toEqual({ id, ...newLocation, roomCount: 0 });
    });

    it('answers 404 for an unknown id, even when the body is invalid', async () => {
      const { status, body } = await api.http
        .patch(`${BASE}/loc_missing`)
        .set(auth)
        .send({ name: 'X' });

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Location not found' });
    });

    it('answers 422 and changes nothing for a partial body', async () => {
      const location = await create();

      const { status, body } = await api.http
        .patch(`${BASE}/${location.id}`)
        .set(auth)
        .send({ name: 'Renamed Hub' });

      expect(status).toBe(422);
      expect(Object.keys(body.fieldErrors as object)).toEqual([
        'city',
        'address',
        'timezone',
        'opensAt',
        'closesAt',
        'status',
      ]);
      expect((await get(location.id)).body).toEqual(location);
    });

    it('answers 422 for a closing time that is not after the opening time', async () => {
      const { id } = await create();

      const { status, body } = await api.http
        .patch(`${BASE}/${id}`)
        .set(auth)
        .send({ ...newLocation, closesAt: '07:00' });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ closesAt: 'Closing time must be after opening time' });
    });

    it('answers 404 for a deleted location', async () => {
      const { id } = await create();
      await api.http.delete(`${BASE}/${id}`).set(auth);

      const { status } = await api.http.patch(`${BASE}/${id}`).set(auth).send(newLocation);

      expect(status).toBe(404);
    });
  });

  describe('DELETE /locations/:id', () => {
    it('removes a location without rooms with 204 and no body', async () => {
      const { id } = await create();

      const removed = await api.http.delete(`${BASE}/${id}`).set(auth);

      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');
      expect(removed.headers['content-type']).toBeUndefined();
      expect((await get(id)).status).toBe(404);
      const { body } = await api.http.get(`${BASE}?limit=100`).set(auth);
      expect((body.items as { id: string }[]).map((item) => item.id)).not.toContain(id);
    });

    it('keeps the row, marked with the time of the clock', async () => {
      const { id } = await create();
      await api.http.delete(`${BASE}/${id}`).set(auth);

      const row = await prisma.client.location.findUnique({ where: { id } });

      expect(row?.deletedAt).toEqual(SEED_NOW);
    });

    it('answers 409 and keeps the location while it has rooms', async () => {
      const { status, body } = await api.http.delete(`${BASE}/loc_2`).set(auth);

      expect(status).toBe(409);
      expect(body).toEqual({ message: 'Remove or move the rooms of this location first' });
      expect((await get('loc_2')).status).toBe(200);
    });

    it('answers 409 for a location whose only rooms are maintenance or retired', async () => {
      const { id } = await create();
      await addRoom(id, { status: 'maintenance' });
      await addRoom(id, { status: 'retired' });

      expect((await api.http.delete(`${BASE}/${id}`).set(auth)).status).toBe(409);
    });

    it('does not count deleted rooms', async () => {
      const { id } = await create();
      await addRoom(id, { deletedAt: SEED_NOW });

      expect((await get(id)).body.roomCount).toBe(0);
      expect((await api.http.delete(`${BASE}/${id}`).set(auth)).status).toBe(204);
    });

    it('counts the rooms that still exist', async () => {
      const { id } = await create();
      await addRoom(id);
      await addRoom(id);
      await addRoom(id, { deletedAt: SEED_NOW });

      expect((await get(id)).body.roomCount).toBe(2);
    });

    it('answers 404 for an unknown or an already deleted id', async () => {
      const { id } = await create();
      await api.http.delete(`${BASE}/${id}`).set(auth);

      for (const target of ['loc_missing', id]) {
        const { status, body } = await api.http.delete(`${BASE}/${target}`).set(auth);

        expect(status).toBe(404);
        expect(body).toEqual({ message: 'Location not found' });
      }
    });

    it('waits for a room being added and then refuses to delete', async () => {
      const { id } = await create();
      let removal: Promise<{ status: number; body: unknown }> | undefined;

      await prisma.client.$transaction(async (tx) => {
        const { id: roomId, seq } = await nextEntityId(tx, 'room');
        await tx.room.create({
          data: {
            id: roomId,
            seq,
            locationId: id,
            name: 'Late Room',
            type: 'hot_desk',
            capacity: 1,
            hourlyRate: 1000,
            amenities: [],
            status: 'available',
          },
        });
        // The delete starts while the room is not committed yet; it has to queue behind it.
        removal = api.http
          .delete(`${BASE}/${id}`)
          .set(auth)
          .then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const { status, body } = (await removal) ?? { status: 0, body: undefined };
      expect(status).toBe(409);
      expect(body).toEqual({ message: 'Remove or move the rooms of this location first' });
      expect((await get(id)).status).toBe(200);
    });

    it('lets one of two simultaneous deletes win', async () => {
      const { id } = await create();

      const results = await Promise.all([
        api.http.delete(`${BASE}/${id}`).set(auth),
        api.http.delete(`${BASE}/${id}`).set(auth),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([204, 404]);
    });
  });
});
