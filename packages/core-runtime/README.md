# @clankamode/core-runtime

Shared runtime primitives for `clanka-core`: event kernel, run/line diff helpers, env-backed config loading, and retry.

> Not published to the public npm registry yet. Use the repo workspace / local build.

## Install / import

```ts
import {
  ClankaKernel,
  loadConfig,
  diffRuns,
  formatLineDiff,
  retry,
} from '@clankamode/core-runtime';
```

Package entry is the root export only (`main` / `exports["."]` → `dist/index.js`). There are no subpath exports.

## Public API

### Kernel (`ClankaKernel`, `toCanonical`)
- Append-only event kernel (`type` is an open `string`; CLI default startup label is `run.start`).
- Types: `CognitiveEvent`, `Invariant`, `RuntimeState`, `VerifyResult`.
- `verify()` checks digest, `seq`, causes, `runId === sessionId`, `v === 1.1` (`EVENT_SCHEMA_VERSION`), and finite non-decreasing timestamps. It does **not** re-run registered invariants; those run during `log()`.
- Failed invariants append `invariant.failed` without re-entering `log()` / `enforceInvariants`, with the cause pinned to the triggering event (`ctx.event`).

### Diff
- `diffRuns` / `formatDiffMarkdown` — compare two event sequences by `seq`.
- `diffLines` — contextual `+`/`-` line diff (`contextLines` only).
- `formatLineDiff` — stringifies a line diff and optionally truncates via `maxLines` / `truncationMarker`.
- `truncateDiffLines` — low-level truncation helper used by `formatLineDiff`.
- `summarizePayload` — compact JSON preview helper.
- `maxLines` applies only through `formatLineDiff` (not `diffLines`).

### Config (`loadConfig`, `parseEnvFile`, `ConfigValidationError`)
- Merge priority per schema key: `config` object → `env` → `.env` file(s) → schema defaults/optionals.
- `envPrefix` / `envMap` control env var names; `envMap` wins when set (including empty-string mapped names).
- Unknown keys in the `config` object are passed through to Zod, so `.strict()` rejects them and `.passthrough()` keeps them.

### Retry (`retry`)
- Retries failed sync/async operations with exponential backoff, optional jitter, and `AbortSignal`.
- `maxRetries` is the number of retries **after** the first attempt (total attempts = `maxRetries + 1`). Default `maxRetries` is `3`.
