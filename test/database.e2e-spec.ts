import * as argon2 from 'argon2';
import pg from 'pg';
import { nextEntityId } from '../src/database/entity-id.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { canonicalDigest } from './support/digest.js';
import { loadSeedGolden } from './support/golden.js';
import { readSeedTables } from './support/read-seed-tables.js';
import { createTestDatabase, type TestDatabase } from './support/test-database.js';
import { testApp, type TestApp } from './support/test-app.js';

const golden = loadSeedGolden();

describe('database', () => {
  let database: TestDatabase;
  let api: TestApp;
  let prisma: PrismaService['client'];
  let sql: pg.Client;

  beforeAll(async () => {
    database = await createTestDatabase();
    api = await testApp({ DATABASE_URL: database.url });
    prisma = api.app.get(PrismaService).client;
    sql = new pg.Client({ connectionString: database.url });
    await sql.connect();
  });

  afterAll(async () => {
    await sql.end();
    await api.close();
    await database.drop();
  });

  describe('seed', () => {
    it('stores the mock records, value for value', async () => {
      const tables = await readSeedTables(prisma);

      expect(
        Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
      ).toEqual(golden.counts);
      expect(
        Object.fromEntries(
          Object.entries(tables).map(([name, rows]) => [name, canonicalDigest(rows)]),
        ),
      ).toEqual(golden.sha256);
    });

    it('stores argon2id hashes of the demo password', async () => {
      const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });

      expect(users.map((user) => user.email)).toEqual([
        'admin@coworking.test',
        'manager@coworking.test',
      ]);
      for (const user of users) {
        expect(user.passwordHash).toMatch(/^\$argon2id\$/);
        expect(await argon2.verify(user.passwordHash, 'demo1234')).toBe(true);
      }
    });

    it('continues the id numbering after the last seeded entity', async () => {
      const [{ last_value: last }] = (await sql.query('SELECT last_value FROM entity_seq')).rows;
      const first = await nextEntityId(prisma, 'loc');
      const second = await nextEntityId(prisma, 'bk');

      expect(last).toBe(String(golden.sequence));
      expect(first).toEqual({ id: 'loc_138', seq: 1412n });
      expect(second).toEqual({ id: 'bk_139', seq: 1413n });
    });
  });

  describe('collation', () => {
    it('is ICU, so names sort the way the mock API sorts them', async () => {
      const { rows } = await sql.query<{ icu: boolean; names: string[] }>(
        `SELECT 'a' < 'B' AS icu,
                (SELECT array_agg(name ORDER BY name, seq) FROM locations) AS names`,
      );

      expect(rows[0]?.icu).toBe(true);
      expect(rows[0]?.names).toEqual([
        'Canal Yard',
        'Harbour Studio',
        'Market Square Loft',
        'Old Mill Works',
        'Riverside Hub',
      ]);
    });
  });

  describe('constraints', () => {
    let inserted = 0;
    const insertBooking = (room: string, from: string, to: string, status = 'pending') => {
      inserted += 1;
      return sql.query(
        `INSERT INTO bookings (id, seq, room_id, member_id, starts_at, ends_at, attendees,
                               status, total_price, created_at)
         VALUES ($1, $2, $3, 'mem_12', $4, $5, 1, $6, 0, $4)`,
        [`bk_test${inserted}`, 10_000 + inserted, room, from, to, status],
      );
    };

    // No seeded booking touches 2030. Every test books its own room, so none depends on another.
    const at = (hour: number) => `2030-01-01T${String(hour).padStart(2, '0')}:00:00Z`;
    const bookConfirmed = (room: string) => insertBooking(room, at(9), at(11), 'confirmed');

    it('rejects a booking that overlaps an occupying one in the same room (23P01)', async () => {
      await bookConfirmed('room_6');

      await expect(insertBooking('room_6', at(10), at(12))).rejects.toMatchObject({
        code: '23P01',
      });
      await expect(insertBooking('room_6', at(8), at(10))).rejects.toMatchObject({
        code: '23P01',
      });
    });

    it('allows bookings that touch, like the back-to-back seeded ones', async () => {
      await bookConfirmed('room_7');

      await insertBooking('room_7', at(11), at(12));
      await insertBooking('room_7', at(8), at(9));
    });

    it('allows an overlap with a booking that no longer occupies the room, or in another room', async () => {
      await bookConfirmed('room_8');

      await insertBooking('room_8', at(9), at(11), 'cancelled');
      await insertBooking('room_9', at(9), at(11));
    });

    it('rejects a booking that ends before it starts (23514)', async () => {
      await expect(insertBooking('room_10', at(15), at(14))).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('keeps an email unique among members that are not deleted (23505)', async () => {
      const { rows } = await sql.query<{ id: string; email: string }>(
        `SELECT id, email FROM members ORDER BY seq LIMIT 2`,
      );
      const first = rows.at(0);
      const second = rows.at(1);
      if (first === undefined || second === undefined) throw new Error('members are not seeded');

      await expect(
        sql.query(`UPDATE members SET email = $1 WHERE id = $2`, [first.email, second.id]),
      ).rejects.toMatchObject({ code: '23505' });

      await sql.query(`UPDATE members SET deleted_at = '2026-10-14T09:00:00Z' WHERE id = $1`, [
        first.id,
      ]);
      await sql.query(`UPDATE members SET email = $1 WHERE id = $2`, [first.email, second.id]);
    });
  });

  describe('GET /health', () => {
    it('answers ok when the database answers', async () => {
      const { status, body } = await api.http.get('/health');

      expect(status).toBe(200);
      expect(body).toEqual({ status: 'ok' });
    });

    it('answers 500 when it does not', async () => {
      const down = await testApp({ DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:1/none' });
      try {
        const { status, body } = await down.http.get('/health');

        expect(status).toBe(500);
        expect(body).toEqual({ message: 'Internal server error' });
      } finally {
        await down.close();
      }
    });
  });
});
