import type * as z from 'zod';
import { invalidFromIssues } from './field-errors.js';

/**
 * Parses input inside a service, for bodies that must be checked after the 404 and 409 checks
 * (a pipe would answer 422 first). Failure is the same 422 the pipe produces.
 */
export const parseInput = <S extends z.ZodType>(schema: S, data: unknown): z.output<S> => {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw invalidFromIssues(result.error.issues);
};
