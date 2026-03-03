# Task: Fix tests, wire replay CLI command, and clean up packages/core

## Goal
`clanka-core` has a broken test suite (mixed node:test + vitest test runners causing failures)
and a partially-built `packages/core/` sub-package that never got wired to the CLI.
Fix all tests, add the `replay` CLI command that plays back a recorded run event-by-event with
timestamps, and mark TASKS.md tasks done.

## Non-goals
- Do NOT publish to npm (that requires secrets)
- Do NOT restructure to monorepo or change package.json name/version
- Do NOT modify the CI publish workflow

## Hard constraints
- `npx vitest run` must exit 0 with all tests passing at the end
- No new test failures may be introduced
- Branch: feat/replay-and-test-fix — do NOT push to main

## Done when
```
npx vitest run          # exits 0, all tests green
node dist/cli.js replay <runId>   # prints events line by line with timestamps
node dist/cli.js --help           # shows replay in command list
```
