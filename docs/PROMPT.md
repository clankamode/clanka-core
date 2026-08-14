# Task: Fix tests, wire replay CLI command, and clean up packages/core

> **Archive (completed):** March 2026 prompt for the replay/vitest exec plan.
> Not the open backlog — see `TASKS.md`. Tests are vitest-based; CLI `replay` is wired.

## Goal (achieved)

At prompt time the suite mixed `node:test` and vitest, and `packages/core/replay.ts` was not wired to the CLI. That work finished: vitest runs green, and `node dist/cli.js replay <runId>` prints events with timestamps.

## Non-goals (unchanged)

- Do not publish to npm from this archive prompt (still requires secrets / `NPM_TOKEN`; see open item in `TASKS.md`)
- This prompt did not restructure package names/versions

## Hard constraints (met)

- `npx vitest run` exits 0
- Branch used: `feat/replay-and-test-fix` (not main)

## Done when (met)

```
npx vitest run          # exits 0
node dist/cli.js replay <runId>   # events with timestamps
node dist/cli.js --help           # lists replay
```
