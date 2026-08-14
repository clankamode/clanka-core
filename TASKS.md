# TASKS.md — clanka-core
> Last updated: 2026-08-14 | Status: mostly complete — npm registry publish still open

## 🔴 High Priority
- [x] **Expand test coverage for `runtime/`** — add tests for: event ordering invariants, replay determinism, invalid event payloads (zod rejection), concurrent run isolation
- [x] **Document the event schema** — ensure `CONTRACT.md` covers every event type with required/optional fields and example payloads
- [ ] **Publish to npm as `@clankamode/core`** — scaffolding is in place (`publishConfig.access=public`, CI publish workflow, `.npmignore`), but the package is **not** on the npm registry (`npm view @clankamode/core` → 404 as of 2026-08-14). Publish skips when `NPM_TOKEN` is unset. Workspace packages `@clankamode/core-runtime` and `@clankamode/core-cli` are also unpublished.

## 🟡 Medium Priority
- [x] **`diff.ts` — add tests** — write tests for: added/removed/modified lines, binary file handling, large diff truncation
- [x] **CLI: `replay` command** — `node dist/cli.js replay <runId>` replays a recorded run with event stream + timestamps
- [x] **CLI: `export` command** — `node dist/cli.js export <runId> --format json|markdown` (completed 2026-03-04)
- [x] **Add `packages/` sub-package structure** — split into `@clankamode/core-runtime` and `@clankamode/core-cli` (completed 2026-03-06)

## 🟢 Low Priority / Nice to Have
- [x] **`dogfood.ts` / `dogfood-simple.ts` cleanup** — remove superseded scratch scripts
- [x] **`test-ls.ts` / `gen-golden.ts` cleanup** — remove superseded scratch scripts

## 🧠 Notes
- CLI: `node dist/cli.js <command>` — commands: `run`, `log`, `replay`, `verify`, `ls`, `export`, `diff`, `help` (`--help` / `-h`)
- `run <runId>` refuses to overwrite an existing `runs/<runId>.jsonl` unless `--force` is passed
- Empty `ls` and empty-history `replay` print errors on stderr (non-zero silence is not success)
- `export` defaults to pretty-printed JSON event arrays (not raw JSONL reprint)
- CLI / `ClankaKernel` emit `run.start` (not EventLog’s `run.started`); see `docs/event-schema.md`
- `src/runtime/` — core event runtime, `src/diff.ts` — diff utilities
- `runs/` stores recorded run artifacts as `<runId>.jsonl`
- `packages/core/` is in-repo EventLog / schema modules (no `package.json`; not an npm workspace package)
