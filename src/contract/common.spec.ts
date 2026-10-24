import { apiErrorSchema, pageQuerySchema } from './common.js';

describe('pageQuerySchema', () => {
  it('applies defaults and coerces numeric strings', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(pageQuerySchema.parse({ page: '3', limit: '50', q: '  loft ' })).toEqual({
      page: 3,
      limit: 50,
      q: 'loft',
    });
  });

  it('rejects a page below 1 and a limit outside 1..100', () => {
    expect(pageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts a bare message, field errors and booking conflicts', () => {
    const conflict = {
      id: 'bk_1',
      startsAt: '2026-10-14T09:00:00.000Z',
      endsAt: '2026-10-14T10:00:00.000Z',
    };

    expect(apiErrorSchema.safeParse({ message: 'Not found' }).success).toBe(true);
    expect(
      apiErrorSchema.safeParse({ message: 'Validation failed', fieldErrors: { name: 'Required' } })
        .success,
    ).toBe(true);
    expect(apiErrorSchema.safeParse({ message: 'Booked', conflicts: [conflict] }).success).toBe(
      true,
    );
  });

  it('rejects a body without a message', () => {
    expect(apiErrorSchema.safeParse({ fieldErrors: {} }).success).toBe(false);
  });
});
