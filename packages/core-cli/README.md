# @clankamode/core-cli

CLI package for `clanka-core`, backed by `@clankamode/core-runtime`.

## Commands
```bash
clanka-core run <runId>
clanka-core log <runId> <type> <payload-json>
clanka-core replay <runId>
clanka-core verify <runId>
clanka-core ls
clanka-core export <runId> [--format json|markdown]
clanka-core diff <runId1> <runId2> [--json]
```

## Operator notes
- Runs are stored as JSONL under `runs/<runId>.jsonl`.
- `export` (default `--format json`) prints a pretty-printed JSON **array** of events, not the raw JSONL file contents.
- `export --format` requires an explicit `json` or `markdown` value; bare `--format` is an error.
- Unknown options and unexpected extra arguments are rejected (not silently ignored).
- `ls` lists local runs with verify status (`PASS` / `FAIL`).
