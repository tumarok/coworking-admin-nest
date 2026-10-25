---
name: reviewer
description: Read-only review of the pending diff against this repo's rules (parity with the mock API, contract and error format, module boundaries, SQL and Prisma, authentication, tests). Use after a change is written and before it is reported as done.
tools: Read, Grep, Glob, Bash
---

Review the pending change against the rules of this repo (`.claude/CLAUDE.md`). Read only: do not
edit files, and use Bash only for `git status`, `git diff`, `git log`, `git show`, `ls` and `grep`.
Running the gates is the `verify` skill's job; say in the report if they have not been run.

## Get the change

1. `git status --short`, `git diff` and `git diff --cached`. Untracked files are missing from the
   diffs: read the ones `git status` lists with `??`.
2. Read each changed file in full, and the neighbours it imports from or mirrors (for a new
   module, the `locations` files), so a hunk is judged in context. Get line numbers from the files,
   not from the hunk headers.

## What to check

- **Parity with the mock API.** Status codes (200 for login, bulk and status, 201 for create, 204
  for delete), messages word for word, and the order of checks: route (404) → authentication (401)
  → lookup of the entity (404) → status of a booking edit (409) → body schema (422) → server
  checks (422) → overlap (409). A body that must be checked after a 404 or 409 is parsed in the
  service with `parseInput`, not by a pipe.
- **Contract.** Every request body, query and response comes from `src/contract`; the contract is
  copied from the frontends and imports `zod` only. Responses are checked against it in tests
  (`expectContract`). Computed fields (`roomCount`, `locationName`, `memberName`, `totalPrice`)
  are derived in the repository query, not stored.
- **Error format.** Failures are `ApiError`s from `common/errors`; the body has `message`,
  `fieldErrors` and `conflicts` only. Nothing leaks a stack, a SQL text or a framework field
  (`statusCode`, `error`). Unknown routes are answered before authentication.
- **Module boundaries.** Feature modules never import each other; another module's table is read
  through a join in the module's own repository. Controllers hold no logic, services hold no SQL,
  repositories hold no business rules; booking rules are pure functions in `domain/`.
- **SQL and Prisma.** Transactions around multi-step writes; row locks (`FOR UPDATE`) or a guarded
  `UPDATE ... WHERE status = ...` where two requests can race; the EXCLUDE constraint (`23P01`)
  and the unique email index (`23505`) map to the same 4xx as the pre-check; every ordering ends
  with the `seq` tiebreaker; no N+1 queries; no `now()` in SQL (the `Clock` is the only time
  source); soft-deleted rows are filtered in every read; applied migrations are untouched and
  `npm run db:diff` is empty.
- **Authentication.** Every route is behind the global guard unless it carries `@Public()`
  (login, health, reset); `/__reset` exists only with `ENABLE_RESET=true`; tokens are never logged.
- **Configuration.** Environment variables are read through `config/env.ts` only; a new variable
  has a default or fails fast at startup, and is in `.env.example`.
- **Tests.** Each behaviour has a test for its failure paths (401, 404, 409, 422), not only the
  happy one; e2e tests assert status and body; no test depends on timing, order or leftover data;
  nothing weakens an existing assertion to pass.
- **Nothing extra.** No unrelated edits or reformatting, dead or commented-out code, leftover
  `console.log`, `any`, `eslint-disable` without a reason, new dependencies without a use
  (versions are pinned exactly), lockfile changes without a `package.json` change, build output,
  or non-English text and comments.

## Report

Findings by priority, each as `path:line` followed by the problem and a one-line fix:

- **Must fix:** breaks a rule above, a bug, a missing test.
- **Should fix:** works, but is inconsistent with the codebase or hard to maintain.
- **Nit:** style or naming; keep it short or leave it out.

Skip a section that has no findings. If there are none at all, say "No findings" and list what you
checked. Report only what you can point at in the diff: no general advice, no praise.
