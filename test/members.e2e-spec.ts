import type { Response } from 'supertest';
import { Clock } from '../src/common/clock/clock.js';
import { sequenceOf } from '../src/common/ids/ids.js';
import { memberPageSchema, memberSchema } from '../src/contract/index.js';
import { nextEntityId } from '../src/database/entity-id.js';
import { type DbClient, PrismaService } from '../src/database/prisma.service.js';
import type { BookingStatus } from '../src/generated/prisma/enums.js';
import { SEED_NOW } from './support/constants.js';
import { expectContract } from './support/expect-contract.js';
import type { FixedClock } from './support/fixed-clock.js';
import { loadSeedGolden } from './support/golden.js';
import { seededApp, type SeededApp } from './support/seeded-app.js';
import { bearer, signIn } from './support/sign-in.js';

const BASE = '/api/v1/members';
const HOUR = 3_600_000;

const newMember = {
  firstName: 'Dana',
  lastName: 'Testova',
  email: 'dana.testova@example.com',
  phone: '+380 50 123 45 67',
  company: null,
  plan: 'flex',
  status: 'active',
} as const;

// The seeded members in list order (last name, then first name): [id, first name, last name].
const SORTED = [
  ['mem_1m', 'Dominic', 'Balistreri'],
  ['mem_2z', 'Jayson', 'Bartoletti'],
  ['mem_13', 'Afton', 'Bauch'],
  ['mem_1t', 'Elisa', 'Bauch'],
  ['mem_1p', 'Jammie', 'Beahan'],
  ['mem_22', 'Maudie', 'Bechtelar'],
  ['mem_1u', 'Chanelle', 'Beer'],
  ['mem_20', 'Jackeline', 'Bergnaum'],
  ['mem_1s', 'Marsha', 'Bergnaum'],
  ['mem_2h', 'Helene', 'Bernhard'],
] as const;
// The end of the list, where a hyphenated name and equal last names sit.
const LAST = [
  ['mem_34', 'Ayla', 'Swift'],
  ['mem_18', 'Amani', 'Toy-Klocko'],
  ['mem_1f', 'Chanelle', 'Treutel'],
  ['mem_2v', 'Alessandro', 'Vandervort'],
  ['mem_30', 'Dorian', 'Vandervort'],
  ['mem_19', 'Nicola', 'Watsica'],
  ['mem_2k', 'Jennifer', 'Wilkinson'],
  ['mem_2s', 'Blanca', 'Will'],
  ['mem_23', 'Candice', 'Wolf'],
  ['mem_12', 'Kiley', 'Wolf'],
] as const;

const REQUIRED = 'Invalid input: expected string, received undefined';
const PLAN_ERROR = 'Invalid option: expected one of "day_pass"|"flex"|"dedicated"|"team"';
const STATUS_ERROR = 'Invalid option: expected one of "active"|"suspended"|"cancelled"';
const EMAIL_ERROR = 'Enter a valid email';
const PHONE_ERROR = 'Enter a valid phone number';
const EMAIL_TAKEN = { email: 'This email is already registered' };

const golden = loadSeedGolden();

describe('members (read)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;

  const list = async (query = '') => {
    const { status, body } = await api.http.get(`${BASE}${query}`).set(auth);
    expect(status).toBe(200);
    return expectContract(memberPageSchema, body);
  };
  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);
  const names = (page: { items: { firstName: string; lastName: string }[] }) =>
    page.items.map((item) => `${item.firstName} ${item.lastName}`);

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
      ['GET', `${BASE}/mem_12`],
      ['POST', BASE],
      ['PATCH', `${BASE}/mem_12`],
      ['DELETE', `${BASE}/mem_12`],
    ] as const)('answers %s %s with 401 without a token', async (method, path) => {
      const { status, body } = await api.http[method.toLowerCase() as 'get'](path);

      expect(status).toBe(401);
      expect(body).toEqual({ message: 'Authentication required' });
    });
  });

  describe('GET /members', () => {
    it('lists the 80 members by last name and then first name', async () => {
      const page = await list('?limit=100');

      expect(page).toMatchObject({ total: 80, page: 1, limit: 100 });
      expect(page.items).toHaveLength(80);
      expect(
        page.items.slice(0, SORTED.length).map((m) => [m.id, m.firstName, m.lastName]),
      ).toEqual(SORTED.map((row) => [...row]));
      expect(page.items.slice(-LAST.length).map((m) => [m.id, m.firstName, m.lastName])).toEqual(
        LAST.map((row) => [...row]),
      );
    });

    it('returns the first 20 by default', async () => {
      const page = await list();

      expect(page).toMatchObject({ total: 80, page: 1, limit: 20 });
      expect(page.items).toHaveLength(20);
    });

    it('returns the fields of the seeded record', async () => {
      const { items } = await list('?q=ayla.swift');

      expect(items).toEqual([
        {
          id: 'mem_34',
          firstName: 'Ayla',
          lastName: 'Swift',
          email: 'ayla.swift@example.com',
          phone: expect.stringMatching(/^\+380 \d\d \d{3} \d\d \d\d$/),
          company: null,
          plan: 'team',
          status: 'active',
          joinedAt: expect.stringMatching(/^\d{4}-\d\d-\d\d$/),
        },
      ]);
    });

    it('returns a company as text for the members that have one', async () => {
      const { items } = await list('?q=afton%20bauch');

      expect(items).toMatchObject([{ id: 'mem_13', company: 'Oberbrunner Group' }]);
    });

    it('pages the sorted list', async () => {
      const second = await list('?page=2&limit=4');

      expect(names(second)).toEqual([
        'Jammie Beahan',
        'Maudie Bechtelar',
        'Chanelle Beer',
        'Jackeline Bergnaum',
      ]);
      expect(second).toMatchObject({ total: 80, page: 2, limit: 4 });
    });

    it('answers a page beyond the last with no items and the total', async () => {
      expect(await list('?page=99')).toEqual({ items: [], total: 80, page: 99, limit: 20 });
    });

    it('answers the last page with the rest', async () => {
      const page = await list('?page=3&limit=30');

      expect(page.items).toHaveLength(20);
      expect(ids(page).at(-1)).toBe('mem_12');
    });

    it.each([
      ['day_pass', 15],
      ['flex', 14],
      ['dedicated', 25],
      ['team', 26],
    ])('filters by plan %s', async (plan, total) => {
      const page = await list(`?plan=${plan}&limit=100`);

      expect(page.total).toBe(total);
      expect(page.items.every((item) => item.plan === plan)).toBe(true);
    });

    it.each([
      ['active', 71],
      ['suspended', 3],
      ['cancelled', 6],
    ])('filters by status %s', async (status, total) => {
      const page = await list(`?status=${status}&limit=100`);

      expect(page.total).toBe(total);
      expect(page.items.every((item) => item.status === status)).toBe(true);
    });

    it('combines the plan and the status', async () => {
      expect((await list('?plan=day_pass&status=suspended')).total).toBe(3);
      expect((await list('?plan=team&status=cancelled')).total).toBe(4);
      expect((await list('?plan=dedicated&status=cancelled')).total).toBe(0);
    });

    it.each([
      ['the last name', '?q=bauch', ['Afton Bauch', 'Elisa Bauch']],
      ['the first name', '?q=jammie', ['Jammie Beahan']],
      ['the full name, across the space', '?q=afton%20bauch', ['Afton Bauch']],
      ['a part of the full name, across the space', '?q=ton%20bau', ['Afton Bauch']],
      ['the name, whatever the case', '?q=ELISA%20bAuCh', ['Elisa Bauch']],
      ['a trimmed text', '?q=%20%20jammie%20', ['Jammie Beahan']],
      ['the email', '?q=jammie.beahan73', ['Jammie Beahan']],
      ['the email, whatever the case', '?q=AYLA.SWIFT%40EXAMPLE.COM', ['Ayla Swift']],
      ['the company', '?q=oberbrunner', ['Afton Bauch']],
      ['the company, whatever the case', '?q=OBERBRUNNER%20GROUP', ['Afton Bauch']],
    ])('searches %s', async (_what, query, expected) => {
      expect(names(await list(`${query}&limit=100`))).toEqual(expected);
    });

    it.each([
      ['nothing, when it is empty', '?q=', 80],
      ['nothing, when it is blank', '?q=%20%20', 80],
      ['an email domain, which every member has', '?q=example.com', 80],
      ['no one, when nothing contains it', '?q=zzz', 0],
      ['% as a plain character', '?q=%25', 0],
      ['_ as a plain character', '?q=_', 45],
    ])('searches %s', async (_what, query, total) => {
      expect((await list(query)).total).toBe(total);
    });

    it('does not search the phone, the plan or the status', async () => {
      expect((await list('?q=%2B380')).total).toBe(0);
      expect((await list('?q=day_pass')).total).toBe(0);
      expect((await list('?q=suspended')).total).toBe(0);
    });

    it('finds members without a company by the other fields', async () => {
      expect(names(await list('?q=jammie'))).toEqual(['Jammie Beahan']);
      expect(names(await list('?q=maudie_bechtelar'))).toEqual(['Maudie Bechtelar']);
    });

    it('orders the matches of a search like the whole list', async () => {
      expect(names(await list('?q=wolf'))).toEqual(['Candice Wolf', 'Kiley Wolf']);
      expect(names(await list('?q=vandervort'))).toEqual([
        'Alessandro Vandervort',
        'Dorian Vandervort',
      ]);
    });

    it('combines the filters with the search and the paging', async () => {
      expect(names(await list('?q=wolf&plan=dedicated'))).toEqual(['Kiley Wolf']);
      expect(names(await list('?q=bauch&status=suspended'))).toEqual([]);

      const paged = await list('?plan=team&status=active&limit=5&page=2');
      expect(paged).toMatchObject({ total: 22, page: 2, limit: 5 });
      expect(paged.items).toHaveLength(5);
    });

    it('treats an empty filter as no filter', async () => {
      expect((await list('?plan=&status=&q=')).total).toBe(80);
    });

    it('keeps the last of a repeated key', async () => {
      expect((await list('?status=cancelled&status=active')).total).toBe(71);
      expect((await list('?plan=team&plan=flex')).total).toBe(14);
      expect(names(await list('?q=zzz&q=jammie'))).toEqual(['Jammie Beahan']);
    });

    it('ignores unknown keys', async () => {
      expect((await list('?sort=lastName&foo=bar')).total).toBe(80);
    });

    it.each([
      ['limit=abc', { limit: 'Invalid input: expected number, received NaN' }],
      ['limit=0', { limit: 'Too small: expected number to be >=1' }],
      ['limit=101', { limit: 'Too big: expected number to be <=100' }],
      ['page=0', { page: 'Too small: expected number to be >=1' }],
      ['page=abc', { page: 'Invalid input: expected number, received NaN' }],
      ['page=1.5', { page: 'Invalid input: expected int, received number' }],
      ['plan=gold', { plan: PLAN_ERROR }],
      ['plan=Team', { plan: PLAN_ERROR }],
      ['status=closed', { status: STATUS_ERROR }],
      [
        'limit=abc&plan=gold&status=closed',
        {
          limit: 'Invalid input: expected number, received NaN',
          plan: PLAN_ERROR,
          status: STATUS_ERROR,
        },
      ],
    ])('rejects ?%s with 422', async (query, fieldErrors) => {
      const { status, body } = await api.http.get(`${BASE}?${query}`).set(auth);

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors });
    });
  });

  describe('GET /members/:id', () => {
    it('returns the member', async () => {
      const { status, body } = await api.http.get(`${BASE}/mem_13`).set(auth);

      expect(status).toBe(200);
      expect(expectContract(memberSchema, body)).toEqual({
        id: 'mem_13',
        firstName: 'Afton',
        lastName: 'Bauch',
        email: 'afton_bauch70@example.com',
        phone: expect.stringMatching(/^\+380 \d\d \d{3} \d\d \d\d$/),
        company: 'Oberbrunner Group',
        plan: 'day_pass',
        status: 'active',
        joinedAt: expect.stringMatching(/^\d{4}-\d\d-\d\d$/),
      });
    });

    it('answers a trailing slash', async () => {
      expect((await api.http.get(`${BASE}/mem_13/`).set(auth)).status).toBe(200);
    });

    it('answers 404 for an unknown id', async () => {
      const { status, body } = await api.http.get(`${BASE}/mem_missing`).set(auth);

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Member not found' });
    });
  });
});

describe('members (write)', () => {
  let api: SeededApp;
  let auth: ReturnType<typeof bearer>;
  let prisma: PrismaService;
  let clock: FixedClock;
  let counter = 0;

  /** An address no other test uses. */
  const email = () => `member${++counter}@example.com`;
  const draft = () => ({ ...newMember, email: email() });

  const create = async (input: object = draft()) => {
    const { status, body } = await api.http.post(BASE).set(auth).send(input);
    expect(status).toBe(201);
    return expectContract(memberSchema, body);
  };
  const get = (id: string) => api.http.get(`${BASE}/${id}`).set(auth);
  const remove = (id: string) => api.http.delete(`${BASE}/${id}`).set(auth);
  const patch = (id: string, input: object) =>
    api.http.patch(`${BASE}/${id}`).set(auth).send(input);
  const post = (input: object) => api.http.post(BASE).set(auth).send(input);
  /** The ids of the members whose name, email or company contains `q`, in list order. */
  const idsMatching = async (q: string) =>
    (
      (await api.http.get(BASE).query({ q, limit: 100 }).set(auth)).body.items as {
        id: string;
      }[]
    ).map((item) => item.id);
  const total = async () => (await api.http.get(`${BASE}?limit=1`).set(auth)).body.total as number;

  /** Creates a member with the clock at `instant` (a token lasts 12 hours), then puts it back. */
  const createAt = async (instant: Date) => {
    clock.set(instant);
    try {
      const token = await signIn(api);
      const { status, body } = await api.http.post(BASE).set(bearer(token)).send(draft());
      expect(status).toBe(201);
      return expectContract(memberSchema, body);
    } finally {
      clock.set(SEED_NOW);
    }
  };

  const createRoom = async () => {
    const { status, body } = await api.http.post('/api/v1/rooms').set(auth).send({
      locationId: 'loc_1',
      name: 'Onyx',
      type: 'meeting_room',
      capacity: 6,
      hourlyRate: 2500,
      amenities: [],
      status: 'available',
    });
    expect(status).toBe(201);
    return (body as { id: string }).id;
  };
  const bookingData = async (
    tx: DbClient,
    memberId: string,
    status: BookingStatus,
    startsAt: Date,
    endsAt: Date,
    roomId: string,
  ) => {
    const { id, seq } = await nextEntityId(tx, 'bk');
    return {
      id,
      seq,
      roomId,
      memberId,
      startsAt,
      endsAt,
      attendees: 1,
      status,
      notes: null,
      totalPrice: 0,
      createdAt: SEED_NOW,
    };
  };
  /** A booking straight in the table in a room of its own: bookings have no endpoint yet. */
  const addBooking = async (
    memberId: string,
    status: BookingStatus,
    startsAt: Date,
    endsAt: Date,
  ) => {
    const data = await bookingData(
      prisma.client,
      memberId,
      status,
      startsAt,
      endsAt,
      await createRoom(),
    );
    await prisma.client.booking.create({ data });
  };
  const at = (hours: number) => new Date(SEED_NOW.getTime() + hours * HOUR);

  /** A member row written inside a transaction, as another request would write it. */
  const insertMember = async (tx: DbClient, address: string) => {
    const { id, seq } = await nextEntityId(tx, 'mem');
    await tx.member.create({
      data: { id, seq, ...newMember, email: address, joinedAt: SEED_NOW },
    });
  };

  /** Whether a backend of this database is blocked on a lock. */
  const lockWaiting = async () => {
    const rows = await prisma.client.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    return (rows.at(0)?.waiting ?? 0) > 0;
  };

  /** Sends `request` while `hold` has uncommitted writes, and commits once it waits for them. */
  const queuedBehind = async (
    hold: (tx: DbClient) => Promise<void>,
    request: () => PromiseLike<Response>,
  ) => {
    let queued: Promise<Response> | undefined;
    await prisma.client.$transaction(async (tx) => {
      await hold(tx);
      queued = Promise.resolve(request());
      queued.catch(() => undefined);
      for (let attempt = 0; attempt < 100 && !(await lockWaiting()); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await lockWaiting()).toBe(true);
    });
    if (queued === undefined) throw new Error('The request was not sent');
    return queued;
  };

  beforeAll(async () => {
    api = await seededApp();
    auth = bearer(await signIn(api));
    prisma = api.app.get(PrismaService);
    clock = api.app.get<FixedClock>(Clock);
  });

  afterAll(async () => {
    await api.close();
  });

  describe('POST /members', () => {
    it('creates a member with 201, the join date of the clock and the fields sent', async () => {
      const input = draft();

      const member = await create(input);

      expect(member).toEqual({
        id: expect.stringMatching(/^mem_[0-9a-z]+$/),
        ...input,
        joinedAt: '2026-10-14',
      });
      expect((await get(member.id)).body).toEqual(member);
    });

    it('gives the next id of the counter every entity shares', async () => {
      const first = await create();
      const second = await create();

      expect(sequenceOf(first.id)).toBeGreaterThan(golden.sequence);
      expect(sequenceOf(second.id)).toBe(sequenceOf(first.id) + 1);
    });

    it.each([
      ['2026-12-31T23:59:59.999Z', '2026-12-31'],
      ['2027-01-01T00:00:00.000Z', '2027-01-01'],
    ])('dates a member created at %s with the UTC day %s', async (instant, day) => {
      const member = await createAt(new Date(instant));

      expect(member.joinedAt).toBe(day);
      expect((await get(member.id)).body.joinedAt).toBe(day);
    });

    it('trims the text fields and keeps the company it is given', async () => {
      const member = await create({
        ...draft(),
        firstName: '  Dana  ',
        lastName: ' Testova ',
        phone: '  (044) 123-45-67 ',
        company: '  Rules Hub  ',
      });

      expect(member).toMatchObject({
        firstName: 'Dana',
        lastName: 'Testova',
        phone: '(044) 123-45-67',
        company: 'Rules Hub',
      });
    });

    it.each([[''], ['   ']])('stores the company %j as null', async (company) => {
      const member = await create({ ...draft(), company });

      expect(member.company).toBeNull();
      expect((await get(member.id)).body.company).toBeNull();
    });

    it('stores the email in lower case, trimmed', async () => {
      const address = email();

      const member = await create({ ...draft(), email: `  ${address.toUpperCase()} ` });

      expect(member.email).toBe(address);
      const row = await prisma.client.member.findUnique({ where: { id: member.id } });
      expect(row?.email).toBe(address);
    });

    it('ignores the keys the contract does not know', async () => {
      const member = await create({ ...draft(), id: 'mem_mine', joinedAt: '2000-01-01', extra: 1 });

      expect(member.id).not.toBe('mem_mine');
      expect(member.joinedAt).toBe('2026-10-14');
    });

    it('lists the member in the order of the names', async () => {
      const company = `Order ${++counter}`;
      const later = await create({ ...draft(), company, firstName: 'Bea', lastName: 'Zed' });
      const sameLast = await create({ ...draft(), company, firstName: 'Abe', lastName: 'Zed' });
      const earlier = await create({ ...draft(), company, firstName: 'Cal', lastName: 'Abel' });

      expect(await idsMatching(company)).toEqual([earlier.id, sameLast.id, later.id]);
    });

    it('answers 422 with a message for every field an empty-handed request misses', async () => {
      const { status, body } = await post({});

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          firstName: REQUIRED,
          lastName: REQUIRED,
          email: EMAIL_ERROR,
          phone: REQUIRED,
          company: REQUIRED,
          plan: PLAN_ERROR,
          status: STATUS_ERROR,
        },
      });
    });

    it('answers 422 when the body is not JSON', async () => {
      const { status, body } = await api.http.post(BASE).set(auth).send('{broken');

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({ _: 'Invalid input: expected object, received undefined' });
    });

    it.each([
      ['firstName', { firstName: '' }, 'Required'],
      ['firstName', { firstName: '   ' }, 'Required'],
      [
        'firstName',
        { firstName: 'x'.repeat(61) },
        'Too big: expected string to have <=60 characters',
      ],
      ['firstName', { firstName: 7 }, 'Invalid input: expected string, received number'],
      ['lastName', { lastName: '' }, 'Required'],
      [
        'lastName',
        { lastName: 'x'.repeat(61) },
        'Too big: expected string to have <=60 characters',
      ],
      ['email', { email: 'nope' }, EMAIL_ERROR],
      ['email', { email: 'dana@' }, EMAIL_ERROR],
      ['email', { email: '' }, EMAIL_ERROR],
      ['email', { email: 7 }, EMAIL_ERROR],
      ['phone', { phone: 'abc' }, PHONE_ERROR],
      ['phone', { phone: '123456' }, PHONE_ERROR],
      ['phone', { phone: '1'.repeat(21) }, PHONE_ERROR],
      ['phone', { phone: '+38 (050) 12x' }, PHONE_ERROR],
      ['company', { company: 'x'.repeat(81) }, 'Too big: expected string to have <=80 characters'],
      ['company', { company: 5 }, 'Invalid input: expected string, received number'],
      ['plan', { plan: 'gold' }, PLAN_ERROR],
      ['status', { status: 'closed' }, STATUS_ERROR],
    ])('answers 422 for a bad %s', async (field, change, message) => {
      const { status, body } = await post({ ...draft(), ...change });

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: { [field]: message } });
    });

    it('accepts the limits of the contract', async () => {
      const member = await create({
        ...draft(),
        firstName: 'x'.repeat(60),
        lastName: 'y',
        phone: '1234567',
        company: 'z'.repeat(80),
      });

      expect(member).toMatchObject({ phone: '1234567', company: 'z'.repeat(80) });
      expect(await create({ ...draft(), phone: `+${'1'.repeat(19)}` })).toMatchObject({
        phone: `+${'1'.repeat(19)}`,
      });
    });

    it.each([
      ['the same', (address: string) => address],
      ['in another case', (address: string) => address.toUpperCase()],
      ['padded with spaces', (address: string) => `  ${address} `],
    ])('answers 422, not 409, for an address that is taken (%s)', async (_how, write) => {
      const { email: address } = await create();

      const { status, body } = await post({ ...draft(), email: write(address) });

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: EMAIL_TAKEN });
    });

    it('answers 422 for the address of a seeded member', async () => {
      const { status, body } = await post({ ...draft(), email: 'Ayla.Swift@Example.com' });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual(EMAIL_TAKEN);
    });

    it('creates nothing and uses up no id for an address that is taken', async () => {
      const first = await create();
      const before = await total();

      await post({ ...draft(), email: first.email });
      expect(await total()).toBe(before);

      const second = await create();
      expect(sequenceOf(second.id)).toBe(sequenceOf(first.id) + 1);
    });

    it('reports the schema errors only, when the address is taken too', async () => {
      const { email: address } = await create();

      const { body } = await post({ ...draft(), email: address, plan: 'gold' });

      expect(body.fieldErrors).toEqual({ plan: PLAN_ERROR });
    });

    it('gives the address of a deleted member to a new one', async () => {
      const first = await create();
      expect((await remove(first.id)).status).toBe(204);

      const second = await create({ ...draft(), email: first.email });

      expect(second.id).not.toBe(first.id);
      expect(second.email).toBe(first.email);
    });

    it('answers 422 when the address is taken by a request that has not finished yet', async () => {
      const address = email();

      const { status, body } = await queuedBehind(
        (tx) => insertMember(tx, address),
        () => post({ ...draft(), email: address }),
      );

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: EMAIL_TAKEN });
      expect(await prisma.client.member.count({ where: { email: address } })).toBe(1);
    });

    it('lets one of two simultaneous requests for the same address win', async () => {
      const input = draft();

      const results = await Promise.all([post(input), post(input)]);

      expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
      const refused = results.find((result) => result.status === 422);
      expect(refused?.body).toEqual({ message: 'Validation failed', fieldErrors: EMAIL_TAKEN });
      expect(await prisma.client.member.count({ where: { email: input.email } })).toBe(1);
    });
  });

  describe('PATCH /members/:id', () => {
    it('replaces every field and keeps the join date', async () => {
      const { id } = await createAt(new Date('2026-01-15T12:00:00.000Z'));
      const replacement = {
        firstName: 'Dana',
        lastName: 'Renamed',
        email: email(),
        phone: '+380 44 000 00 00',
        company: 'Rules Hub',
        plan: 'team',
        status: 'suspended',
      };

      const { status, body } = await patch(id, replacement);

      expect(status).toBe(200);
      expect(expectContract(memberSchema, body)).toEqual({
        id,
        ...replacement,
        joinedAt: '2026-01-15',
      });
      expect((await get(id)).body).toEqual(body);
    });

    it('keeps the join date of a seeded member', async () => {
      const before = (await get('mem_13')).body as { joinedAt: string };

      const { body } = await patch('mem_13', { ...newMember, email: email() });

      expect(before.joinedAt).not.toBe('2026-10-14');
      expect(body.joinedAt).toBe(before.joinedAt);
    });

    it('lets a member keep its own address, in any case', async () => {
      const member = await create();

      for (const address of [member.email, member.email.toUpperCase(), ` ${member.email} `]) {
        const { status, body } = await patch(member.id, { ...newMember, email: address });

        expect(status).toBe(200);
        expect(body.email).toBe(member.email);
      }
    });

    it('stores a changed address in lower case and frees the old one', async () => {
      const member = await create();
      const address = email();

      const { body } = await patch(member.id, { ...newMember, email: address.toUpperCase() });

      expect(body.email).toBe(address);
      expect(await create({ ...draft(), email: member.email })).toMatchObject({
        email: member.email,
      });
    });

    it('stores an empty company as null', async () => {
      const member = await create({ ...draft(), company: 'Rules Hub' });

      const { body } = await patch(member.id, { ...newMember, email: member.email, company: ' ' });

      expect(body.company).toBeNull();
    });

    it('moves the member in the order of the last names', async () => {
      const company = `Order ${++counter}`;
      const first = await create({ ...draft(), company, lastName: 'Mid' });
      const second = await create({ ...draft(), company, lastName: 'Zed' });
      expect(await idsMatching(company)).toEqual([first.id, second.id]);

      await patch(second.id, { ...newMember, email: second.email, company, lastName: 'Abe' });

      expect(await idsMatching(company)).toEqual([second.id, first.id]);
    });

    it('ignores the keys the contract does not know', async () => {
      const member = await create();

      const { body } = await patch(member.id, {
        ...newMember,
        email: member.email,
        id: 'mem_other',
        joinedAt: '2000-01-01',
      });

      expect(body).toEqual(member);
    });

    it('answers 404 for an unknown id, even when the body is invalid', async () => {
      const { status, body } = await patch('mem_missing', { firstName: 'X' });

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Member not found' });
    });

    it('answers 404 for a deleted member, even with the address of another', async () => {
      const { id } = await create();
      await remove(id);

      const { status, body } = await patch(id, { ...newMember, email: 'ayla.swift@example.com' });

      expect(status).toBe(404);
      expect(body).toEqual({ message: 'Member not found' });
    });

    it('answers 422 and changes nothing for a partial body', async () => {
      const member = await create();

      const { status, body } = await patch(member.id, { firstName: 'Renamed' });

      expect(status).toBe(422);
      expect(body).toEqual({
        message: 'Validation failed',
        fieldErrors: {
          lastName: REQUIRED,
          email: EMAIL_ERROR,
          phone: REQUIRED,
          company: REQUIRED,
          plan: PLAN_ERROR,
          status: STATUS_ERROR,
        },
      });
      expect((await get(member.id)).body).toEqual(member);
    });

    it('answers 422 for bad fields', async () => {
      const member = await create();

      const { status, body } = await patch(member.id, {
        ...newMember,
        email: 'nope',
        phone: 'abc',
        firstName: '',
      });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual({
        firstName: 'Required',
        email: EMAIL_ERROR,
        phone: PHONE_ERROR,
      });
    });

    it.each([
      ['the same', (address: string) => address],
      ['in another case', (address: string) => address.toUpperCase()],
    ])('answers 422 for the address of another member (%s)', async (_how, write) => {
      const other = await create();
      const member = await create();

      const { status, body } = await patch(member.id, { ...newMember, email: write(other.email) });

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: EMAIL_TAKEN });
      expect((await get(member.id)).body).toEqual(member);
    });

    it('answers 422 for the address of a seeded member', async () => {
      const member = await create();

      const { status, body } = await patch(member.id, {
        ...newMember,
        email: 'AYLA.SWIFT@example.com',
      });

      expect(status).toBe(422);
      expect(body.fieldErrors).toEqual(EMAIL_TAKEN);
    });

    it('reports the schema errors only, when the address is taken too', async () => {
      const other = await create();
      const member = await create();

      const { body } = await patch(member.id, { ...newMember, email: other.email, status: 'x' });

      expect(body.fieldErrors).toEqual({ status: STATUS_ERROR });
    });

    it('lets a member take the address of a deleted one', async () => {
      const gone = await create();
      await remove(gone.id);
      const member = await create();

      const { status, body } = await patch(member.id, { ...newMember, email: gone.email });

      expect(status).toBe(200);
      expect(body.email).toBe(gone.email);
    });

    it('answers 422 when the address is taken by a request that has not finished yet', async () => {
      const member = await create();
      const address = email();

      const { status, body } = await queuedBehind(
        (tx) => insertMember(tx, address),
        () => patch(member.id, { ...newMember, email: address }),
      );

      expect(status).toBe(422);
      expect(body).toEqual({ message: 'Validation failed', fieldErrors: EMAIL_TAKEN });
      expect((await get(member.id)).body).toEqual(member);
    });

    it('saves a member that has upcoming bookings', async () => {
      const { id, email: address } = await create();
      await addBooking(id, 'confirmed', at(1), at(2));

      const { status, body } = await patch(id, {
        ...newMember,
        email: address,
        status: 'cancelled',
        plan: 'day_pass',
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ id, status: 'cancelled', plan: 'day_pass' });
    });
  });

  describe('DELETE /members/:id', () => {
    it('removes a member without bookings with 204 and no body', async () => {
      const { id } = await create();

      const removed = await remove(id);

      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');
      expect(removed.headers['content-type']).toBeUndefined();
      expect((await get(id)).status).toBe(404);
    });

    it('keeps the row, marked with the time of the clock', async () => {
      const { id } = await create();
      await remove(id);

      const row = await prisma.client.member.findUnique({ where: { id } });

      expect(row?.deletedAt).toEqual(SEED_NOW);
    });

    it('takes the member out of the search', async () => {
      const member = await create({ ...draft(), firstName: 'Gonzalo', lastName: 'Vanishing' });
      expect(await idsMatching('vanishing')).toEqual([member.id]);

      await remove(member.id);

      expect(await idsMatching('vanishing')).toEqual([]);
    });

    it('answers 404 for an unknown or an already deleted id', async () => {
      const { id } = await create();
      await remove(id);

      for (const target of ['mem_missing', id]) {
        const { status, body } = await remove(target);

        expect(status).toBe(404);
        expect(body).toEqual({ message: 'Member not found' });
      }
    });

    it.each(['pending', 'confirmed', 'checked_in'] as const)(
      'answers 409 and keeps the member while a %s booking has not ended',
      async (bookingStatus) => {
        const { id } = await create();
        await addBooking(id, bookingStatus, at(1), at(2));

        const { status, body } = await remove(id);

        expect(status).toBe(409);
        expect(body).toEqual({ message: 'This member has upcoming bookings; cancel them first' });
        expect((await get(id)).status).toBe(200);
      },
    );

    it('answers 409 for a booking that is under way', async () => {
      const { id } = await create();
      await addBooking(id, 'checked_in', at(-1), at(1));

      expect((await remove(id)).status).toBe(409);
    });

    it('answers 409 when only one of several bookings is upcoming', async () => {
      const { id } = await create();
      await addBooking(id, 'completed', at(-3), at(-2));
      await addBooking(id, 'cancelled', at(1), at(2));
      await addBooking(id, 'pending', at(3), at(4));

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

    it('does not count the upcoming bookings of another member', async () => {
      const busy = await create();
      const { id } = await create();
      await addBooking(busy.id, 'confirmed', at(1), at(2));

      expect((await remove(id)).status).toBe(204);
      expect((await remove(busy.id)).status).toBe(409);
    });

    it('can delete the member again once its upcoming booking is cancelled', async () => {
      const { id } = await create();
      await addBooking(id, 'pending', at(1), at(2));
      expect((await remove(id)).status).toBe(409);

      await prisma.client.booking.updateMany({
        where: { memberId: id },
        data: { status: 'cancelled' },
      });

      expect((await remove(id)).status).toBe(204);
    });

    it('keeps the bookings of a deleted member', async () => {
      const { id } = await create();
      await addBooking(id, 'completed', at(-3), at(-2));
      await remove(id);

      expect(await prisma.client.booking.count({ where: { memberId: id } })).toBe(1);
    });

    it('waits for a booking being added and then refuses to delete', async () => {
      const { id } = await create();
      const roomId = await createRoom();

      const { status, body } = await queuedBehind(
        async (tx) => {
          const data = await bookingData(tx, id, 'confirmed', at(1), at(2), roomId);
          await tx.booking.create({ data });
        },
        () => remove(id),
      );

      expect(status).toBe(409);
      expect(body).toEqual({ message: 'This member has upcoming bookings; cancel them first' });
      expect((await get(id)).status).toBe(200);
    });

    it('lets one of two simultaneous deletes win', async () => {
      const { id } = await create();

      const results = await Promise.all([remove(id), remove(id)]);

      expect(results.map((result) => result.status).sort()).toEqual([204, 404]);
    });
  });
});
