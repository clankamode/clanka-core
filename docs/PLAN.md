# ExecPlan: Fix test suite + add replay CLI command

> **Archive (completed):** March 2026. This is historical context, not the open backlog.
> Current operator status: `TASKS.md`. Tests use vitest; CLI `replay` is wired.

## Outcome (current)

Resolved. As of this archive’s completion (and still true now):

- `npx vitest run` exits 0 (vitest-only suite; no live `node:test` runner mix)
- `node dist/cli.js replay <runId>` prints events with relative timestamps
- Usage lists `replay`

## Original problem (resolved)

At plan start, `clanka-core` mixed `node:test` and `vitest` imports, so vitest reported “No test suite found” on some files. `packages/core/replay.ts` existed but was not wired into the CLI. That mismatch and the unwired replay command were fixed under this plan.

## Scope (as planned)

**In scope (completed):**
- Fix vitest / `node:test` runner mismatch
- Add CLI `replay` (implemented via `loadRun()` + `getHistory()`, not by calling `ReplayHarness`)
- Add `replay` to usage help
- Add vitest coverage for replay
- Update `TASKS.md` for completed replay work
- Branch used: `feat/replay-and-test-fix`

**Out of scope (then and still):**
- npm registry publish (requires secrets / `NPM_TOKEN`)
- Broader monorepo packaging beyond what later landed separately

**Done-when checks (met):**

```
npx vitest run
npm run build && node dist/cli.js replay <runId>
node dist/cli.js 2>&1 | grep replay
```

---

## Architecture (snapshot at plan start)

Historical notes from before the fix — do not treat as current tree state:

- Vitest and `node:test` suites were mixed; several `packages/core/*.test.ts` files failed under vitest until converted or excluded
- `packages/core/replay.ts` (`ReplayHarness`) existed; CLI replay was not yet in `src/cli.ts`
- CLI entry point was (and remains) `src/cli.ts`

Key files touched by the plan:

- `src/cli.ts` — `replay` command
- `src/runtime/kernel.ts` — `ClankaKernel` / `loadFromFile()`
- `packages/core/replay.ts` — examined; CLI chose kernel history playback instead
- `vitest.config.ts` — scoped discovery away from `dist/**`

---

## Milestones

### Milestone 1: Fix the test suite — all vitest runs green

**Status:** done

Converted / scoped tests so `npx vitest run` exits 0.

Commit: `test: fix vitest/node:test runner mismatch`

---

### Milestone 2: Wire replay command into CLI

**Status:** done

`cmdReplay` loads `runs/<runId>.jsonl` and prints `+<deltaMs>ms  [<seq>]  <type>  <payload-preview>`.

Commit: `feat(cli): add replay command`

---

### Milestone 3: Add tests for replay command and update TASKS.md

**Status:** done

Replay tests added; `CLI: replay command` marked done in `TASKS.md`. (npm publish was correctly left open — see current `TASKS.md`.)

Commit: `test(cli): add replay command tests; update TASKS.md`

---

## Progress

- [x] Milestone 1: test suite fixed (`npx vitest run` exits 0)
- [x] Milestone 2: replay command implemented and smoke-tested
- [x] Milestone 3: replay tests added, TASKS.md updated
- [x] All acceptance criteria passing
- [x] Outcomes & Retrospective written

---

## Surprises & Discoveries

- Vitest also picked up compiled files under `dist/` until `vitest.config.ts` excluded them.
- Adjacent events can share a `Date.now()` tick, so multiple `+0ms` lines are valid.
- `src/cli.ts` ran `main()` at import; tests gate with `CLANKA_CORE_CLI_TEST=1`.
- After migrating to vitest syntax, `package.json` `test` was updated to `npx vitest run`.

---

## Decision Log

- Prefer vitest discovery config + conversion over keeping a dual runner.
- CLI replay uses `loadRun()` / `getHistory()` rather than `ReplayHarness` (playback + timestamps only).
- Export `cmdReplay()` and gate `main()` for unit tests.
- Align default `npm test` with vitest.

---

## Outcomes & Retrospective

- Runner mismatch resolved; vitest is the active suite.
- CLI `replay` shipped with relative timestamps.
- Final verification at plan completion: **8 test files**, **150 tests passed** (counts have grown since; re-check with `npm test`).
