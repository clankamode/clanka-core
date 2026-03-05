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
- `run <runId>` - create a run and emit start/commit events
- `log <runId> <type> <payload-json>` - append one event
- `verify <runId>` - verify run integrity/invariants
- `ls` - list stored runs with status
- `export <runId>` - print raw run JSONL

Runs are stored in `runs/<runId>.jsonl`.

## Key Exports
From `packages/core/index.ts`:
- event primitives from `event.ts` (`createEvent`, schemas, digest helpers)
- invariant interfaces/helpers from `invariant.ts`
- append logger from `logger.ts`
- replay harness from `replay.ts`

Key class:
- `ClankaKernel` (`packages/core/kernel.ts`) for event logging + invariant checks

## NPM publish readiness scaffold
- Root package metadata is prepared for `@clankamode/core` with `publishConfig.access=public`.
- CI scaffold is in `.github/workflows/publish.yml` and runs build/test/pack in dry-run mode.
- Actual publish remains opt-in via manual workflow dispatch input: `run_publish=true`.
