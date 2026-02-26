# TASKS.md — clanka-core
> Last updated: 2026-02-25 | Status: open

## 🔴 High Priority
- [ ] **Expand test coverage for `runtime/`** — add tests for: event ordering invariants, replay determinism, invalid event payloads (zod rejection), concurrent run isolation
- [ ] **Document the event schema** — ensure `CONTRACT.md` covers every event type with required/optional fields and example payloads
- [ ] **Publish to npm as `@clankamode/core`** — add `"publishConfig": { "access": "public" }`, CI publish job, `.npmignore`

## 🟡 Medium Priority
- [ ] **`diff.ts` — add tests** — write tests for: added/removed/modified lines, binary file handling, large diff truncation
- [ ] **CLI: `replay` command** — `node dist/cli.js replay <runId>` replays a recorded run with event stream + timestamps
- [ ] **CLI: `export` command** — `node dist/cli.js export <runId> --format json|markdown`
- [ ] **Add `packages/` sub-package structure** — split into `@clankamode/core-runtime` and `@clankamode/core-cli`

## 🟢 Low Priority / Nice to Have
- [ ] **`dogfood.ts` / `dogfood-simple.ts` cleanup** — move to `examples/` or delete if superseded
- [ ] **`test-ls.ts` / `gen-golden.ts` cleanup** — remove or move root-level scratch files

## 🧠 Notes
- CLI: `node dist/cli.js <command>` — commands: `run`, `log`
- `src/runtime/` — core event runtime, `src/diff.ts` — diff utilities
- `blobs/`, `runs/` store recorded run artifacts
