---
name: add-module
description: Checklist for a new feature module (rooms, members, bookings, dashboard) modelled on `src/modules/locations`. Use when adding or extending a module with routes below `/api/v1`.
---

# Add a module

`src/modules/locations` is the reference: copy its shape, not its names. Read it first, together
with `test/locations.e2e-spec.ts`. A module changes only its own folder, plus the shared places
named below.

## Steps

1. **Contract.** The schemas already exist in `src/contract` (copied from the frontends). Do not
   edit them. Derive the output type of the list query with `z.output<typeof …QuerySchema>` in
   `<module>.types.ts`.
2. **Schema.** The tables are in `prisma/schema.prisma` already. If a column or index is missing,
   `npm run db:migrate -- --create-only --name <name>`, review the SQL, apply it, and keep
   `npm run db:diff` empty. Never edit an applied migration.
3. **Repository** (`<module>.repository.ts`, the only file with SQL):
   - lists and single reads are one `$queryRaw` that selects the computed fields of the response
     (`roomCount`, `locationName`, …) with joins; build `WHERE` from `allOf` and `containsAny`
     (`database/sql-filters.ts`), end every `ORDER BY` with `seq`, page with `pageOffset`;
   - hide soft-deleted rows (`deleted_at IS NULL`) in every read and join, and in lookups of
     related entities;
   - writes use the Prisma client; ids come from `nextEntityId`; time comes from the `Clock`,
     never from SQL;
   - a write that depends on other rows (delete with children, unique email, overlap) runs in a
     transaction with the row locked (`FOR UPDATE`), and maps the database error
     (`23505`, `23P01`) to the same 4xx as the pre-check.
4. **Service** (`<module>.service.ts`, no SQL): lookup → 404 with `notFound('<Entity>')`; a body that
   must be checked after the lookup (PATCH) goes through `parseInput(schema, body)`; conflicts are
   `conflict('<message>')`; messages are word for word those of the mock API and of the golden scenario
   (`test/fixtures/golden/scenario.json`).
5. **Controller** (`<module>.controller.ts`, no logic): `@ApiTags`, one `@ApiRoute` per route with the
   contract schema of the response; `@Query({ schema })` and `@Body({ schema })` for input that a
   pipe may reject first; `@Body() body: unknown` plus `ApiRoute({ body })` for PATCH;
   `@HttpCode(200)` where the mock answers 200 on a POST, `204` for deletes.
6. **Module** (`<module>.module.ts`) and a line in `apiModules` of `src/api.module.ts`. Register the
   module's schemas (item, input, page) in `src/common/openapi/components.ts`.
7. **Unit tests** for pure rules (`domain/` files, mappers) next to the code.
8. **E2E tests** `test/<module>.e2e-spec.ts` on `seededApp()`: split into a read-only `describe`
   (seed data, one app) and a write `describe` (its own app, each test creates its own rows);
   check every response with `expectContract`, 401 on every route, 404, 409, 422 with the exact
   `fieldErrors`, empty and repeated query values, `limit=abc`, a page beyond the last, and the
   seeded numbers from `test/fixtures/golden/seed.json`. Concurrency tests only where a race is possible.
9. **Docs.** The OpenAPI test in `test/docs.e2e-spec.ts` lists the module's routes; extend it.
10. Run the gates in the order of the `verify` skill, then report.

## Pitfalls

- A pipe answers 422 before the handler runs: anything that must answer 404 or 409 first has to be
  parsed in the service.
- Zod runs a `refine` after a failed regex or length check, but not after a missing field or a wrong
  type; the mock behaves the same, so assert what the API does.
- Raw rows carry `bigint` and `numeric` as `BigInt`/`Decimal`: cast to `int` in SQL.
- Injected classes are imported as values (decorator metadata), not with `import type`.
- Feature modules never import each other; read another module's table by a join in your own
  repository. Related soft-deleted rows are excluded by the join condition.
- When a module takes a row of another one as a foreign key (rooms → location), lock that row
  `FOR SHARE` inside the writing transaction and check `deleted_at IS NULL` there, so it cannot be
  deleted at the same moment (`locations` deletes under `FOR UPDATE`).
