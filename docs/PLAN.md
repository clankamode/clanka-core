# ExecPlan: Fix test suite + add replay CLI command

## Purpose

`clanka-core` has a broken test suite caused by two test runners being mixed — some files use
`node:test` (imported as `import { test } from 'node:test'`) and others use `vitest`. When vitest
picks up `node:test`-style tests, it reports "No test suite found" and exits non-zero. There is
also a `packages/core/` sub-package with a `replay.ts` and tests that were written but never
wired into the main CLI. After this work, running `npx vitest run` exits 0, and
`node dist/cli.js replay <runId>` plays back a recorded run's events in order with timestamps.

## Scope

**In scope:**
- Fix all failing vitest tests (resolve node:test vs vitest runner mismatch)
- Wire `packages/core/replay.ts` into `src/cli.ts` as the `replay` command
- Add `replay` to the usage() help text
- Add vitest tests for the replay command in `src/cli.ts` (or via `packages/core/replay.test.ts`)
- Update `TASKS.md` to mark completed items done
- Commit to branch `feat/replay-and-test-fix`

**Out of scope:**
- npm publish (requires secrets)
- Monorepo restructure
- CI workflow changes
- Changing package.json name or version

**Hard constraints:**
- `npx vitest run` must exit 0 with all tests green at the end
- No regressions in the 17 kernel.vitest.test.ts tests that currently pass
- All new code must have tests
- Branch: `feat/replay-and-test-fix` — never commit to main

## Done when

    npx vitest run
    # Expected: all test files green, exit code 0

    npm run build && node dist/cli.js run test-replay-run
    node dist/cli.js replay test-replay-run
    # Expected: events printed line by line, each prefixed with relative timestamp (ms)

    node dist/cli.js 2>&1 | grep replay
    # Expected: "  replay <runId>" appears in usage output

---

## Architecture

The repo has two test systems in conflict:

- `src/runtime/kernel.vitest.test.ts` — vitest-style (`describe`/`it`/`expect` from vitest), 17 tests, currently PASSING
- `src/runtime/kernel.test.ts` — node:test-style (`import { test } from 'node:test'`), fails under vitest ("No test suite found")
- `packages/core/*.test.ts` — also node:test-style, also fail under vitest

The `packages/core/` directory contains:
- `replay.ts` — `ReplayHarness` class: loads a run's JSONL file, iterates events in seq order
- `event.ts` — Event type definition (v1.1 schema)
- `kernel.ts`, `logger.ts`, `recorder.ts`, `schema-registry.ts`, `verify.ts` — supporting modules
- `*.test.ts` — tests for each module, all node:test-style

The main CLI entry point is `src/cli.ts`. The `replay` command should:
1. Accept `<runId>` argument
2. Load the run from `runs/<runId>.jsonl` using the existing `loadRun()` helper
3. Print each event as: `+<ms>  <seq>  <type>  <payload-summary>`
   where `+<ms>` is milliseconds since the first event's timestamp
4. Exit 0 on success, 1 if run not found

Key files:
- `src/cli.ts` — CLI entry point; add `replay` command here
- `src/runtime/kernel.ts` — `ClankaKernel` class, `loadFromFile()` method
- `packages/core/replay.ts` — `ReplayHarness` class (examine before deciding how to use it)
- `vitest.config.ts` (or `package.json` vitest config) — controls which files vitest picks up
- `tsconfig.json` — TypeScript config for compilation

---

## Milestones

### Milestone 1: Fix the test suite — all vitest runs green

The goal of this milestone is `npx vitest run` exiting 0 with no failures.

The root cause is vitest picking up `node:test`-style files. The fix is to configure vitest's
`include` pattern to only pick up vitest-compatible tests, OR convert the `node:test` files to
vitest syntax. Examine the vitest config and the failing test files, then choose the cleanest fix.

Prefer converting `node:test` files to vitest syntax if the tests are straightforward — it
consolidates the test system. If a file is complex or has node:test-specific patterns, exclude it
from vitest instead and note the exclusion in a comment.

After the fix, verify:

    npx vitest run
    # Expected: exit 0, all files green

Commit: `test: fix vitest/node:test runner mismatch`

**Acceptance criteria:**

    npx vitest run
    # exits 0 — no FAIL lines in output

**Status:** done

---

### Milestone 2: Wire replay command into CLI

The goal is `node dist/cli.js replay <runId>` printing a run's events with relative timestamps.

Read `packages/core/replay.ts` to understand `ReplayHarness` — its API, what it loads, what it
returns. Then add a `cmdReplay(runId: string)` function in `src/cli.ts` that:

1. Loads the run JSONL from `runs/<runId>.jsonl`
2. Uses either `ReplayHarness` or the existing `loadRun()` + `getHistory()` to iterate events
3. For each event, prints: `+<deltaMs>ms  [<seq>]  <type>  <payload-preview>`
   where `deltaMs` is `event.timestamp - firstEvent.timestamp`
   and `payload-preview` is `JSON.stringify(event.payload).slice(0, 80)`
4. Exits 0 on success, throws (caught by main()) if run not found

Add `replay` to the `usage()` function output.

After implementing, build and smoke-test:

    npm run build
    node dist/cli.js run smoke-replay
    node dist/cli.js log smoke-replay run.step '{"step":1}'
    node dist/cli.js replay smoke-replay
    # Expected: 2–3 lines of events with +0ms, +Nms timestamps

Commit: `feat(cli): add replay command`

**Acceptance criteria:**

    npm run build && node dist/cli.js run smoke-replay-check 2>/dev/null || true
    node dist/cli.js replay smoke-replay-check 2>&1 | grep -E '^\+[0-9]'
    # Expected: lines starting with +0ms or similar

**Status:** pending

---

### Milestone 3: Add tests for replay command and update TASKS.md

Add vitest tests for the `replay` command. The cleanest approach is a test in
`src/index.test.ts` or a new `src/cli.test.ts` that:
1. Creates a temporary run via `ClankaKernel`
2. Saves it to a temp `runs/` directory
3. Calls `cmdReplay()` (exported or testable) and captures stdout
4. Asserts: correct number of lines, `+0ms` on first event, events in seq order

Also update `TASKS.md`:
- Mark `[ ] CLI: replay command` as `[x]`
- Check if `[ ] Publish to npm` is still accurate (it is — don't mark it done)

Commit: `test(cli): add replay command tests; update TASKS.md`

**Acceptance criteria:**

    npx vitest run
    # exits 0, replay tests appear in output as passing

**Status:** pending

---

## Progress

- [x] Milestone 1: test suite fixed (npx vitest run exits 0)
- [ ] Milestone 2: replay command implemented and smoke-tested
- [ ] Milestone 3: replay tests added, TASKS.md updated
- [ ] All acceptance criteria passing
- [ ] Outcomes & Retrospective written

---

## Surprises & Discoveries

- `npx vitest run` initially still failed after converting `node:test` imports because vitest auto-discovered compiled files in `dist/`.
  Evidence:
  - `FAIL  dist/index.test.js ... Error: No test suite found`
  - `FAIL  dist/runtime/kernel.test.js ... Error: No test suite found`
- Adding `vitest.config.ts` with `include: ['src/**/*.test.ts', 'packages/**/*.test.ts']` and `exclude: ['dist/**', 'node_modules/**']` resolved accidental `dist/` suite pickup.

---

## Decision Log

- Milestone 1 course correction: after converting test imports from `node:test` to `vitest`, added explicit vitest discovery config to exclude `dist/**` because stale compiled test files caused false failures. This kept the migration scoped and preserved all 149 test assertions.

---

## Outcomes & Retrospective

*(not yet complete)*
