# @clankamode/core-runtime

Runtime/event kernel primitives extracted from `clanka-core`.

> Not published to the public npm registry yet. Use the repo workspace / local build.

## Exports
From `packages/core-runtime/src/index.ts`:

- `ClankaKernel`, `toCanonical` — append-only event kernel (`type` is an open `string`; CLI default startup label is `run.start`)
- Types: `CognitiveEvent`, `Invariant`, `RuntimeState`, `VerifyResult`
- `loadConfig`, `parseEnvFile`, `ConfigValidationError`
- Diff helpers: `diffRuns`, `formatDiffMarkdown`, `diffLines`, `formatLineDiff`, `truncateDiffLines`, `summarizePayload`
- `retry` — exponential backoff helper
