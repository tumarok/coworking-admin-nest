# coworking-admin-nest

REST API for the Coworking Admin frontends, built with NestJS 12, Prisma 7 and PostgreSQL 18. It is
a drop-in replacement for the mock back-end that the
[React](https://github.com/tumarok/coworking-admin-react),
[Angular](https://github.com/tumarok/coworking-admin-angular) and
[Next.js](https://github.com/tumarok/coworking-admin-next) versions of the admin panel ship with:
the same `/api/v1` contract, the same status codes and messages, the same deterministic demo data
and the same `POST /__reset` for their end-to-end tests. The frontends run against it unchanged.

The domain is a network of coworking spaces: locations, rooms, members and bookings, with a
dashboard of the day's occupancy.

- **A booking cannot be double-booked.** The overlap is checked under a row lock and an
  `EXCLUDE` constraint backs it up, so two concurrent requests for one room cannot both succeed.
  The loser gets a 409 that lists the booking in its way.
- **Rules that match the mock to the byte.** Opening hours on the location's own clock, at most 8
  hours, room capacity, price from the hourly rate, the status workflow `pending → confirmed →
checked_in → completed` plus cancel and no-show, one by one or in bulk. The responses are checked
  against recordings of the mock.
- **One contract.** The Zod schemas of the frontends validate requests, shape responses, feed the
  OpenAPI document and are used by the tests, so they cannot drift apart.
- **Real authentication.** Argon2id password hashes and HS256 JWTs; every route except sign-in,
  `/health` and `/__reset` needs a token.
- **Runs anywhere Docker does.** `docker compose up` starts PostgreSQL, applies the migrations,
  seeds the demo data and serves the API; a profile adds the three frontends on top of it.

## Quick start

### With Docker

```bash
docker compose up --build --wait
```

The API answers on http://127.0.0.1:4010 and its documentation on http://127.0.0.1:4010/docs. Sign
in with **admin@coworking.test** / **demo1234**. Ports are published on the loopback interface only.

```bash
docker compose --profile full up --build --wait
```

adds the frontends, each wired to this API: React on http://127.0.0.1:8081, Angular on
http://127.0.0.1:8082 and Next.js on http://127.0.0.1:8083. `docker compose down --volumes` removes
everything, data included. `API_PORT` and `DB_PORT` move the published ports when 4010 or 5433 are
taken.

### Local development

Requires Node.js 24 (`.nvmrc`) and Docker for the database.

```bash
npm ci
cp .env.example .env
npm run db:up        # PostgreSQL on 127.0.0.1:5433
npm run db:deploy    # apply the migrations
npm run db:seed      # demo data, skipped if the database already has users
npm run dev          # the API with reload on http://127.0.0.1:4010
```

`npm run db:reset` drops everything and seeds again. The environment is validated when the
application starts and the start fails with a list of every problem.

| Variable       | Default       | Meaning                                                                   |
| -------------- | ------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL` | required      | PostgreSQL connection string.                                             |
| `JWT_SECRET`   | required      | Signing secret, at least 32 characters.                                   |
| `JWT_TTL`      | `12h`         | Token lifetime: a number and `s`, `m`, `h` or `d`.                        |
| `PORT`         | `4010`        | Port of the API.                                                          |
| `ENABLE_RESET` | `false`       | Serve `POST /__reset`, which rebuilds the demo data. Never in production. |
| `CORS_ORIGINS` | empty         | Comma-separated origins allowed by CORS. The frontends are same-origin.   |
| `SEED`         | `42`          | Seed of the demo data generator.                                          |
| `LOG_LEVEL`    | `log`         | `fatal`, `error`, `warn`, `log`, `debug` or `verbose`.                    |
| `NODE_ENV`     | `development` | `development`, `production` or `test`.                                    |

## Using it with the frontends

None of the three frontends needs a change. Each reaches the API through its own server, so no CORS
setup is needed: the React and Angular images proxy `/api` to the API (`API_UPSTREAM`), and the
Next.js app forwards its `/bff/*` calls to it (`API_URL`).

| Frontend | Development                                             | End-to-end suite against this API                                                                        |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| React    | `npm run dev`: the Vite proxy targets `localhost:4010`  | start the API with `ENABLE_RESET=true`, then `npm run e2e`: it reuses the server on 4010                 |
| Angular  | `npm start`: `proxy.conf.json` targets `localhost:4010` | the same, or `E2E_BASE_URL=http://localhost:8082 npm run e2e` against the compose stack                  |
| Next.js  | `API_URL=http://localhost:4010 npx next dev`            | `E2E_API_URL=http://localhost:4010 npm run e2e`, or add `E2E_BASE_URL=http://localhost:8083` for compose |

The end-to-end suites call `POST /__reset` before every mutating test, so the API must run with
`ENABLE_RESET=true` (the compose stack does). Run them with `CI` unset, and check that the API
answers on 4010 first: without it Playwright starts the frontend's own mock and passes for the
wrong reason.

Results against this API (Chromium and Firefox where the suite has both): React 9 of 9, Angular
120 of 120, Next.js 275 of 275, on the host and, for Angular and Next.js, against the compose
stack. No test needed a change in either side.

## Stack

| Area          | Choice                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Framework     | NestJS 12 on Express 5, ESM, TypeScript 6                                     |
| Database      | PostgreSQL 18; Prisma 7 with the `pg` driver adapter; raw SQL for lists       |
| Contract      | Zod 4 schemas, used through Standard Schema for validation and for OpenAPI    |
| Auth          | `@nestjs/jwt` (HS256), Argon2id password hashes, a global guard               |
| Documentation | `@nestjs/swagger` builds an OpenAPI 3.1 document, Scalar serves it on `/docs` |
| Tests         | Vitest 5, Supertest, Testcontainers (PostgreSQL), SWC for decorator metadata  |
| Tooling       | ESLint 10 with `eslint-plugin-boundaries`, Prettier 3                         |
| CI/CD         | GitHub Actions, Docker images on GHCR                                         |

Why these, where the choice is not obvious:

- **Prisma plus hand-written SQL.** Prisma owns the schema, the migrations and single-row writes.
  What it cannot express lives in the migration SQL: the `btree_gist` extension, the `EXCLUDE`
  constraint against overlapping bookings, the partial unique index on member emails, the shared
  id sequence. Prisma ignores those objects, so `db:diff` still compares cleanly. Lists are
  `$queryRaw` because they return computed fields (`roomCount`, `locationName`, `totalPrice`, …)
  from the same query that filters, sorts and counts.
- **No double bookings, in two layers.** A booking locks its room row (`FOR UPDATE`), so requests
  for one room queue and the second sees the first in the overlap check. The `EXCLUDE` constraint
  on `tstzrange(starts_at, ends_at, '[)')` stops any insert that bypassed the check, and its error
  becomes the same 409.
- **Soft delete.** Locations, rooms and members are marked deleted, not removed, so bookings keep
  valid references and history. A delete that depends on child rows locks the row first, and a
  booking checks `deleted_at` under lock so it cannot be added to something being deleted.
- **Ids and ordering.** Ids such as `bk_3a` come from one shared sequence, and every list ends its
  `ORDER BY` with the sequence number, so equal names have a stable order. Names sort with the ICU
  collation, matching the locale-aware sorting of the mock.
- **A deterministic seed.** The generator is a call-for-call port of the mock's, so the same seed
  and the same reference time give the same data. A test compares it with a recording of the mock.
- **JWT.** Tokens carry the user id in `sub` and expire after `JWT_TTL`. Any problem with a token
  (missing, malformed, expired, unknown user) is the same 401, so a client learns nothing from it.
- **Own environment module.** `EnvModule` parses `process.env` once with Zod and provides it as a
  token; nothing else reads `process.env`. Tests change single values without touching the process.
- **Pinned versions.** Every dependency is pinned exactly. TypeScript stays on 6.0 because
  `@nestjs/swagger` and typescript-eslint have not moved past it.

## Architecture

```
src/main.ts, app.module.ts, configure-app.ts   entry files
src/common/      errors, validation, auth, clock, ids, pagination, OpenAPI helpers
src/config/      environment schema
src/contract/    Zod contract shared with the frontends; imports only zod
src/database/    Prisma service, entity ids, SQL fragments, seed generator and writer
src/modules/     auth, locations, rooms, members, bookings, dashboard, health
src/dev/         the reset endpoint
prisma/          schema and migrations
test/            end-to-end tests, helpers, recordings of the mock (fixtures/golden)
docker/          Dockerfile with two targets
```

Each feature module is a controller, a service and a repository. The controller maps HTTP to the
contract and documents the route, the service holds the rules and decides error codes, and the
repository is the only place with SQL. Booking rules (hours, price, status transitions) are pure
functions in `modules/bookings/domain`. Feature modules never import each other, and ESLint
(`eslint-plugin-boundaries`) enforces this together with the direction of the layers.

**A request.** Express reads the body as bytes and parses it as UTF-8 JSON, so a broken body
reaches validation like any other and gets the same answer as from the mock. Then a route is
matched (`No route for GET /x` for a miss, below the prefix and outside it alike), the global guard
checks the token, a pipe validates the query or the body against the contract, and the controller
calls the service. A single exception filter turns every failure into the error format below.

**Time.** A booking is stored as `timestamptz` and checked against the opening hours on the clock
of its location. Everything that needs the current time goes through an injected `Clock`, which is
why tests can freeze it.

## API

Interactive documentation is on `/docs` (Scalar); the OpenAPI document is built from the mounted
routes, and a test fails if a route is missing from it or documented with a wrong response. Paths
are below `/api/v1`:

| Area      | Routes                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Auth      | `POST /auth/login`, `GET /auth/me`                                                                        |
| Dashboard | `GET /dashboard?date=`                                                                                    |
| Locations | `GET`, `POST /locations`; `GET`, `PATCH`, `DELETE /locations/:id`                                         |
| Rooms     | `GET`, `POST /rooms`; `GET`, `PATCH`, `DELETE /rooms/:id`                                                 |
| Members   | `GET`, `POST /members`; `GET`, `PATCH`, `DELETE /members/:id`                                             |
| Bookings  | `GET`, `POST /bookings`; `GET`, `PATCH /bookings/:id`; `POST /bookings/:id/status`, `POST /bookings/bulk` |

Lists take `page`, `limit`, `q` and filters, and answer `{ items, total, page, limit }`. `POST
/__reset` (only with `ENABLE_RESET=true`, otherwise it answers like an unknown route) is below the
prefix too; `GET /health` is outside it.

Every failure has the same body, and the message is part of the contract:

```json
{
  "message": "Validation failed",
  "fieldErrors": { "name": "Required", "amenities.1": "Too short" }
}
```

`fieldErrors` appears on 422, keyed by the path of the field (`_` for the body as a whole), and
`conflicts` (`id`, `startsAt`, `endsAt` of the bookings in the way) on a 409 for an overlapping
booking. Codes in use: 401 not signed in, 404 not found, 409 conflict, 413 body over 100 kB, 422
validation, 500 unexpected.

## Testing

| Suite  | Runs on                   | What it covers                                                                           |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| unit   | Vitest                    | booking rules and transitions, environment, errors, seed against its recording, services |
| e2e    | Vitest, Supertest, Docker | every route against a real PostgreSQL: responses, errors, rules, races                   |
| timing | Vitest, Docker            | the speed of `/__reset`, run after the others on an idle machine                         |

`npm test` runs 1118 tests (252 unit, 866 end to end) with coverage thresholds of 95 % lines,
statements and functions and 88 % branches (currently 98.8 % lines and 90.3 % branches).

- **Real database.** One PostgreSQL container starts per run (Testcontainers). A migrated and
  seeded template database is copied for each test file, so files run in parallel and may change
  their copy freely.
- **Contract on every response.** Each response is parsed with the contract schema of its route
  (`expectContract`).
- **Parity with the mock.** Recordings of the mock API in `test/fixtures/golden` (the seed, the
  dashboard for 14 dates, a 62-step scenario across all modules) are replayed against this API
  and must match.
- **Races.** Concurrent creates and edits of one room, status changes and bulk actions, deletes
  against inserts. A helper makes one request wait behind the other instead of sleeping.
- **OpenAPI.** The mounted routes, the document and the response schemas must agree.

```bash
npm test                    # everything, with coverage (Docker required)
npm run test:unit           # no Docker needed
npm run test:e2e -- test/bookings.e2e-spec.ts
```

## Scripts

| Script                                    | Description                                              |
| ----------------------------------------- | -------------------------------------------------------- |
| `npm run dev` / `npm start`               | API with reload / the compiled API                       |
| `npm run build`                           | Compile to `dist`                                        |
| `npm run typecheck`                       | `tsc --noEmit` over the sources and the tests            |
| `npm run lint`                            | ESLint, including the module boundaries                  |
| `npm run format` / `npm run format:check` | Prettier                                                 |
| `npm test`, `test:unit`, `test:e2e`       | Vitest with coverage / unit only / end to end and timing |
| `npm run test:watch`                      | Vitest in watch mode                                     |
| `npm run db:up`                           | Start the compose database and wait until it is healthy  |
| `npm run db:migrate`                      | Create and apply a migration in development              |
| `npm run db:deploy`                       | Apply the existing migrations                            |
| `npm run db:seed` / `npm run db:reset`    | Seed an empty database / drop everything and seed        |
| `npm run db:diff`                         | Fail if `schema.prisma` and the migrations disagree      |
| `npm run db:generate`                     | Generate the Prisma client (also runs after `npm ci`)    |

## CI/CD

[GitHub Actions](.github/workflows/ci.yml) runs on every push to `main`, on `v*` tags and on pull
requests:

1. **checks:** typecheck, lint, format check, migrations against the schema, tests with coverage
   thresholds, build;
2. **smoke:** builds the images, starts the stack with Compose and calls `/health`, `/auth/me` and
   the login;
3. **images** (pushes only): builds and publishes to GHCR
   - `ghcr.io/tumarok/coworking-admin-nest`: the API, about 410 MB on disk, run as a non-root user;
   - `ghcr.io/tumarok/coworking-admin-nest-migrate`: applies the migrations and seeds an empty
     database, then exits. It carries the Prisma CLI, which the API image does not need.

   Tags: `latest` for `main`, `sha-<commit>`, and `1.2.3` / `1.2` for a `v1.2.3` tag.

## Contributing

Before a commit, `npm run typecheck && npm run lint && npm run format:check && npm run db:diff &&
npm test && npm run build` must pass. Commits follow Conventional Commits. Applied migrations are
never edited: a change is a new migration. The contract changes only together with the frontends.

The working rules for contributors are in `.claude/CLAUDE.md`.

## License

[MIT](LICENSE)
