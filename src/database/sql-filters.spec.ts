import { Prisma } from '../generated/prisma/client.js';
import { allOf, containsAny } from './sql-filters.js';

describe('allOf', () => {
  it('is TRUE without conditions', () => {
    expect(allOf([]).text).toBe('TRUE');
  });

  it('joins the conditions with AND and keeps their values in order', () => {
    const sql = allOf([Prisma.sql`a = ${1}`, Prisma.sql`b = ${'x'}`]);

    expect(sql.text).toBe('a = $1 AND b = $2');
    expect(sql.values).toEqual([1, 'x']);
  });
});

describe('containsAny', () => {
  it('searches every column for the needle, passed as a value and not as text', () => {
    const sql = containsAny('50%_off', [Prisma.raw('l.name'), Prisma.raw('l.city')]);

    expect(sql.text).toBe(
      '(strpos(lower(l.name), lower($1)) > 0 OR strpos(lower(l.city), lower($2)) > 0)',
    );
    expect(sql.values).toEqual(['50%_off', '50%_off']);
  });
});
