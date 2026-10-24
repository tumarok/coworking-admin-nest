import { Prisma } from '../generated/prisma/client.js';

/** Conditions joined with AND; no conditions is no restriction. */
export const allOf = (conditions: Prisma.Sql[]): Prisma.Sql =>
  conditions.length === 0 ? Prisma.sql`TRUE` : Prisma.join(conditions, ' AND ');

/**
 * Matches rows where any of the columns contains `needle`, ignoring case. `strpos` treats `%` and
 * `_` as ordinary characters, which a `LIKE` pattern would not. The columns are SQL fragments
 * written in the repository (`Prisma.raw('l.name')`), never user input.
 */
export const containsAny = (needle: string, columns: Prisma.Sql[]): Prisma.Sql =>
  Prisma.sql`(${Prisma.join(
    columns.map((column) => Prisma.sql`strpos(lower(${column}), lower(${needle})) > 0`),
    ' OR ',
  )})`;
