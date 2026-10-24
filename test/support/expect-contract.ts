import type * as z from 'zod';

/**
 * Asserts that a response body is exactly what the contract describes: it passes the schema and
 * carries no key the schema does not know (Zod strips those silently, so the parse is compared).
 */
export const expectContract = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => {
  const result = schema.safeParse(body);
  if (!result.success) {
    expect.fail(`The body breaks the contract:\n${JSON.stringify(result.error.issues, null, 2)}`);
  }
  expect(body).toEqual(result.data);
  return result.data;
};
