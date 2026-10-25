# Coworking Admin (NestJS)

REST API `/api/v1` on NestJS 12 and PostgreSQL 18 for the Coworking Admin frontends (React,
Angular, Next.js). It replaces their mock API without changes on their side. `README.md` describes
the product; this file holds the working rules.

## Before reporting a change as done

```bash
npm run typecheck && npm run lint && npm run format:check && npm run db:diff && npm test && npm run build
```

Run them in this order and one at a time. `db:diff` compares the `db` service of `compose.yaml`
(`npm run db:up`, migrations applied with `npm run db:migrate`) with `prisma/schema.prisma`; it must
print "No difference detected". The `verify` skill explains how to read failures.

## Layout and module boundaries

```
src/main.ts, app.module.ts, configure-app.ts   entry files
src/common/      errors, validation, auth, clock, ids, pagination, openapi
src/config/      environment schema
src/contract/    Zod contract copied from the frontends; imports zod only
src/database/    Prisma service, entity ids, seed generator and writer
src/modules/     feature modules: controller -> service -> repository (`health` included)
src/dev/         reset endpoint; answers `No route for ...` unless ENABLE_RESET=true
test/            e2e tests and helpers
```

- The API prefix `api/v1` is applied by `RouterModule` (`common/http/api-prefix.ts`), not by a global
  prefix: Nest answers unknown routes only below a global prefix, and this API answers them
  everywhere (`No route for ...` below the prefix, `Not found` outside it).
- `createHttpAdapter()` carries the Express settings (case sensitive routing, no ETag, query
  parser); `configureApp()` the rest (body, helmet, CORS, pipe, filter). Both are shared by
  `main.ts` and the tests; create the app with `bodyParser: false`.
- The environment is validated by `EnvModule` when the app is created and injected as `@Inject(ENV)`;
  nothing else reads `process.env`.
- Feature modules never import each other. `eslint-plugin-boundaries` enforces the rules in
  `eslint.config.mjs`.
- Relative imports carry the `.js` extension (ESM on `nodenext`).
- Injected classes are imported as values, never with `import type`; tests compile with SWC for
  decorator metadata.
- Every route is behind the global `AuthGuard` unless it carries `@Public()` (login, `/health`,
  `/__reset`). Tokens are HS256 JWTs (`sub` is the user id); any problem with one is the same 401.
  Unknown routes are answered 404 before the guard runs. `src/api.module.ts` lists the modules
  mounted below `api/v1`: a new feature module is added there.
- New feature modules follow `modules/locations` (controller -> service -> repository); the
  `add-module` skill is the checklist. Controllers document every route with `@ApiRoute`
  (`common/openapi`); a schema that deserves a name in the OpenAPI document is registered in
  `common/openapi/components.ts`. `/docs` (Scalar) is built from the mounted routes on first use and
  is the only place with a relaxed CSP.
- The contract changes only together with the frontends. Messages are returned to clients verbatim.

## Database

- Schema changes go through `npm run db:migrate -- --create-only --name <name>`; what Prisma cannot
  express (extensions, `EXCLUDE`, partial indexes, sequences, checks) is appended to that SQL by
  hand. Applied migrations are never edited: fix forward with a new one.
- Prisma ignores those SQL-only objects, so `db:diff` stays empty. Do not "sync" them into
  `schema.prisma`.
- Lists are raw SQL (`$queryRaw`) with `Prisma.sql` fragments (`database/sql-filters.ts`): the
  computed fields come from the same query, and searching is `strpos(lower(..), lower(..))`. Single
  writes use the Prisma client. A delete that depends on related rows locks the row first
  (`FOR UPDATE`) inside a transaction.
- Lists sort with the database's ICU collation and end every ordering with `seq`; ids come from
  `entity_seq` through `nextEntityId`. `seq` is the counter value of the id (`bk_3a` is 118).
- `generateSeed` ports the mock's generator call for call; the order of the faker calls is the
  result. `test/fixtures/golden/seed.json` is recorded from the mock and is never edited by hand.
- E2E tests share one PostgreSQL container (`test/setup/global-setup.ts`) and copy a migrated and
  seeded template per test file with `createTestDatabase()`; a file may change its copy freely.
- Bookings: the room row is locked `FOR UPDATE` (bookings of one room queue, the loser sees the
  winner in the overlap check and answers 409 with real `conflicts`), the member `FOR SHARE`, both
  with `deleted_at IS NULL` checked in the same transaction. The `EXCLUDE` constraint is the net
  for direct inserts (`23P01` maps to the same 409). Statuses that occupy a room are in
  `common/bookings/occupying.ts`; do not copy the list.
- Rooms, members and locations are soft-deleted; their bookings stay, and the mock's orphan rows
  (`locationId: ''`) are deliberately not reproduced.
- `/__reset` rebuilds the seed in one `unnest` insert; the e2e suites of the frontends call it
  before every test, so keep it fast (`test/reset.timing-spec.ts`).

## Tests

- Vitest has three projects: `unit` (no Docker), `e2e` (Testcontainers) and `timing`, which runs
  after the others because it measures `/__reset` on an idle machine. Thresholds are in
  `vitest.config.ts`.
- Every response in an e2e test goes through `expectContract` (`test/support`). The route to
  schema table is `test/support/response-schemas.ts`; `openapi-conformance.e2e-spec.ts` fails when
  a mounted route, the OpenAPI document and that table disagree.
- Parity with the mock is proven by `test/fixtures/golden` (seed, dashboard, a 62-step scenario),
  recorded from the mock by a script outside the repo. Change the golden files only by recording
  them again.
- A race test makes one request wait behind the other with `queuedBehind`
  (`test/support/queued-behind.ts`) instead of sleeping.
- Do not shorten a timeout to make a run faster: the CI runner is slow, and a test that is green
  locally has failed there on timings before.

## Versions

Every dependency is pinned exactly. The ones that are not obvious:

- TypeScript 6.0: `@nestjs/swagger` 12 accepts `^5.5 || ^6.0` and typescript-eslint 8.72 `<6.1`.
- Prisma 7.x, set explicitly: the `latest` dist-tag points to a release candidate of 8. The client
  comes from the `prisma-client` generator into `src/generated/prisma` (ignored by git), is built by
  `postinstall`, and needs the `@prisma/adapter-pg` driver adapter.
- Zod 4.6.7: the validation messages are part of the contract and come from this version.
- ESM only (Nest 12): `"type": "module"`, `nodenext`, `.js` in relative imports.
- Two images from `docker/Dockerfile`: `runtime` (API) and `migrate` (Prisma CLI, migrations and
  seed). The CLI is about 250 MB, which the API does not need.

Known gap: `POST /bookings` with the year `0000` answers 500 (PostgreSQL has no year 0; the mock
accepts it and the frontends never send it).
