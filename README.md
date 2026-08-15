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
# or (after local install / link)
npx clanka-core <command>
```

> **Registry note:** `@clankamode/core`, `@clankamode/core-runtime`, and `@clankamode/core-cli` are **not** published to the public npm registry yet. Use this repo / workspaces locally. CI publish scaffolding exists but requires `NPM_TOKEN`.

## CLI Commands
- `run <runId> [--force]` - create a run and emit `run.start` / `run.commit` (writes `runs/<runId>.jsonl`; refuses overwrite without `--force`)
- `log <runId> <type> <payload-json>` - append one event
- `replay <runId>` - replay a recorded run with event stream and relative timestamps (empty history → stderr error)
- `verify <runId>` - verify digest, seq, causes, v, runId, and timestamps (`PASS` on stdout, `FAIL` details on stderr; does not re-run invariants)
- `ls` - list stored runs with event count, last timestamp, and verify status (no runs → stderr error)
- `export <runId> [--format json|markdown]` - print the run event history as pretty-printed JSON (default) or markdown
- `diff <runId1> <runId2> [--json]` - diff two runs (markdown or JSON output)
- `help` / `--help` / `-h` - print usage

Runs are stored as JSONL in `runs/<runId>.jsonl`. The `export` command does **not** reprint that JSONL file; default `export` emits a JSON array of events. Unknown options and extra positionals are rejected. `export --format` requires an explicit `json` or `markdown` value; bare `--format` is an error.

## Packages
- `@clankamode/core-runtime` — kernel, diff, config, and retry primitives (`packages/core-runtime`; npm workspace)
- `@clankamode/core-cli` — CLI package backed by the runtime (`packages/core-cli`; npm workspace)
- `packages/core` — in-repo EventLog / schema-registry modules (no `package.json`; documented in `CONTRACT.md` and `docs/event-schema.md`)

## Key Exports
From `packages/core/index.ts` (local modules, not a published package):
- event primitives from `event.ts` (`createEvent`, schemas, digest helpers)
- invariant interfaces/helpers from `invariant.ts`
- append logger from `logger.ts`
- replay harness from `replay.ts`

CLI/runtime kernel class:
- `ClankaKernel` from `src/runtime/kernel.ts` (also exported by `@clankamode/core-runtime`)
