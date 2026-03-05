# TASKS.md — clanka-core
> Last updated: 2026-03-01 | Status: open

## 🔴 High Priority
- [x] **Expand test coverage for `runtime/`** — add tests for: event ordering invariants, replay determinism, invalid event payloads (zod rejection), concurrent run isolation
- [x] **Document the event schema** — ensure `CONTRACT.md` covers every event type with required/optional fields and example payloads
- [ ] **Publish to npm as `@clankamode/core`** — add `"publishConfig": { "access": "public" }`, CI publish job, `.npmignore`

## 🟡 Medium Priority
- [x] **`diff.ts` — add tests** — write tests for: added/removed/modified lines, binary file handling, large diff truncation
- [x] **CLI: `replay` command** — `node dist/cli.js replay <runId>` replays a recorded run with event stream + timestamps
- [x] **CLI: `export` command** — `node dist/cli.js export <runId> --format json|markdown` (completed 2026-03-04)
- [x] **Add `packages/` sub-package structure** — split into `@clankamode/core-runtime` and `@clankamode/core-cli` (completed 2026-03-05)

## 🟢 Low Priority / Nice to Have
- [x] **`dogfood.ts` / `dogfood-simple.ts` cleanup** — remove superseded scratch scripts
- [x] **`test-ls.ts` / `gen-golden.ts` cleanup** — remove superseded scratch scripts

## 🧠 Notes
- CLI: `node dist/cli.js <command>` — commands: `run`, `log`
- `src/runtime/` — core event runtime, `src/diff.ts` — diff utilities
- `blobs/`, `runs/` store recorded run artifacts
