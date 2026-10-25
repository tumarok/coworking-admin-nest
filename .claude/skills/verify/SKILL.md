---
name: verify
description: Run the quality gates of this repo in order and read their failures (typecheck, ESLint module boundaries, Prettier, Vitest with Testcontainers, build). Use before reporting a change as done, after editing code, tests or dependencies, and when a gate fails.
---

# Verify

Run the gates in this order and stop at the first failure: the cheap static checks come first, so
a failure points at the real cause. Run them one at a time; coverage and build output share folders.

```bash
npm run typecheck      # tsc --noEmit for src and test
npm run lint           # ESLint: typed rules and module boundaries
npm run format:check   # fix with: npm run format
npm run db:diff        # migrations against schema.prisma; needs `npm run db:up` and `db:migrate`
npm test               # Vitest `unit` and `e2e` projects, with coverage
npm run build
```

Narrow runs while iterating: `npm run test:unit`, `npm run test:e2e -- test/<file>`,
`npm run test:watch`. The last full run must still be the whole list above.

## Reading failures

**`boundaries/dependencies`**: the message names the importing and the imported layer.

- A module imports another module: read the other table through your own repository (a join), or
  move the shared piece into `common`.
- `common`, `config` or `contract` imports upward (a module, `database`): invert the dependency.
- `contract` imports anything but `zod` (`no-restricted-imports`): the contract is copied from the
  frontends and must stay dependency free.

**`db:diff` prints a difference**: `schema.prisma` and the applied migrations disagree. Create a
migration (`npm run db:migrate -- --create-only --name <name>`), review the SQL and apply it. If it
cannot connect, the `db` service is down: `npm run db:up`.

**E2E fails at start**: the `e2e` project needs Docker (Testcontainers pulls `postgres:18-alpine`
on the first run). `Cannot find module .../generated/prisma/client.js` means the Prisma client is
not generated: `npm run db:generate`.

**Decorator metadata in tests**: `Nest can't resolve dependencies` in a Vitest run means the file
was compiled without SWC metadata or an injected class was imported with `import type`. Keep the
SWC plugin in `vitest.config.ts` and import injected classes as values.

**Import errors for `./x.js`**: the repo is ESM on `nodenext`; relative imports carry the `.js`
extension even for `.ts` sources.

## Report

State which gates ran and their result. Name any gate you skipped and why. Do not call the work
done with a failing gate.
