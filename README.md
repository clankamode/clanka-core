# clanka-core

`clanka-core` is the runtime/event kernel for Clanka agent execution traces. It records canonicalized events, verifies invariants, and supports deterministic replay/inspection workflows through both a CLI and reusable core modules.

## Stack
- TypeScript
- Node.js
- `zod` schemas for event/type validation

## Run And Build
Install dependencies:
```bash
npm install
```

Build:
```bash
npm run build
```

Run CLI from source/build:
```bash
node dist/cli.js <command>
# or
npx clanka-core <command>
```

## CLI Commands
- `run <runId>` - create a run and emit start/commit events (writes `runs/<runId>.jsonl`)
- `log <runId> <type> <payload-json>` - append one event
- `replay <runId>` - replay a recorded run with event stream and relative timestamps
- `verify <runId>` - verify run integrity/invariants (`PASS` on stdout, `FAIL` details on failure)
- `ls` - list stored runs with event count, last timestamp, and verify status
- `export <runId> [--format json|markdown]` - print the run event history as pretty-printed JSON (default) or markdown
- `diff <runId1> <runId2> [--json]` - diff two runs (markdown or JSON output)

Runs are stored as JSONL in `runs/<runId>.jsonl`. The `export` command does **not** reprint that JSONL file; default `export` emits a JSON array of events.

## Packages
- `@clankamode/core-runtime` — kernel, diff, config, and retry primitives (`packages/core-runtime`)
- `@clankamode/core-cli` — CLI package backed by the runtime (`packages/core-cli`)
- `packages/core` — EventLog / schema-registry modules documented in `CONTRACT.md` and `docs/event-schema.md`

## Key Exports
From `packages/core/index.ts`:
- event primitives from `event.ts` (`createEvent`, schemas, digest helpers)
- invariant interfaces/helpers from `invariant.ts`
- append logger from `logger.ts`
- replay harness from `replay.ts`

CLI/runtime kernel class:
- `ClankaKernel` from `src/runtime/kernel.ts` (also exported by `@clankamode/core-runtime`)
