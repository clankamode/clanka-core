# Runbook (archive)

> **Archive (completed):** March 2026 runbook for `docs/PLAN.md`.
> Do **not** treat this as active work. Current status: `TASKS.md`. Vitest suite and CLI `replay` are already in place.

This file recorded how an agent was instructed to execute the (now finished) replay + vitest exec plan.

## Source of truth (then)

`docs/PLAN.md` was the source of truth for that plan. Milestones there are marked **done**.

## Per-milestone loop (then)

1. Read the milestone goal and acceptance criteria from `PLAN.md`
2. Implement the changes
3. Run acceptance criteria before moving on
4. Update `PLAN.md` status / checklist / surprises / decision log
5. Commit with the milestone commit label

## Scope discipline (then)

Keep diffs scoped to the then-current milestone. Note out-of-scope breakage in `PLAN.md` Known Issues if needed.

## Branch (then)

Work happened on `feat/replay-and-test-fix`, not on `main`.

## Completion (recorded)

Outcomes & Retrospective were written in `PLAN.md`. Final gate at the time: `npx vitest run` green (see plan retrospective for the then-current count; re-check with `npm test` today).
