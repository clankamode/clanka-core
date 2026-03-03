# Runbook

You are implementing the ExecPlan in docs/PLAN.md for the clanka-core repository.

## Source of truth
docs/PLAN.md is the source of truth. Work milestone by milestone, in order.
Read the full PLAN.md now before starting any work.

## Per-milestone loop
1. Read the milestone goal and acceptance criteria from PLAN.md
2. Implement the changes (name exact files and functions as you go)
3. Run acceptance criteria — if they fail, STOP AND FIX before moving to next milestone
4. Update PLAN.md:
   - Milestone status → done
   - Progress checklist → check off completed items
   - Surprises & Discoveries → note anything unexpected (with evidence snippets)
   - Decision Log → record any course corrections with reasoning
5. Commit with message matching the milestone commit label

## Scope discipline
Keep diffs scoped to the current milestone. Do not expand scope.
If you notice something broken outside scope, note it in PLAN.md Known Issues (add a section if needed).

## Branch
Work on branch feat/replay-and-test-fix. Create it if it doesn't exist.
Never commit to main.

## At completion
Write the Outcomes & Retrospective section in PLAN.md.
Run `npx vitest run` one final time and include the passing test count in the retrospective.
EOF
echo "IMPLEMENT.md written"