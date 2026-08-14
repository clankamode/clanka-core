# @clankamode/core-cli

CLI package for `clanka-core`, backed by `@clankamode/core-runtime`.

> Not published to the public npm registry yet. Use the repo workspace / local build.

## Commands
```bash
clanka-core run <runId> [--force]
clanka-core log <runId> <type> <payload-json>
clanka-core replay <runId>
clanka-core verify <runId>
clanka-core ls
clanka-core export <runId> [--format json|markdown]
clanka-core diff <runId1> <runId2> [--json]
clanka-core help | --help | -h
```

## Operator notes
- Runs are stored as JSONL under `runs/<runId>.jsonl`.
- `run` refuses to overwrite an existing run unless `--force` is passed.
- `export` (default `--format json`) prints a pretty-printed JSON **array** of events, not the raw JSONL file contents.
- `export --format` requires an explicit `json` or `markdown` value; bare `--format` is an error.
- Unknown options and unexpected extra arguments are rejected (not silently ignored).
- `ls` with no runs, and `replay` with an empty history, print errors on stderr.
- `ls` lists local runs with verify status (`PASS` / `FAIL` plus reason).
- Default `run` emits `run.start` then `run.commit` (not EventLog’s `run.started`).
