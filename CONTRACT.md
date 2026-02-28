# Clanka Event Contract (DAR v1.1)

This document describes the event envelope and event-type payload contracts in this repository.

Source of truth used to build this contract:
- `packages/core/event.ts` (`EventTypeSchema`, base `EventSchema`)
- `packages/core/types.ts` (strict payload schemas for several event types)
- `src/runtime/kernel.ts` and `src/cli.ts` (runtime behavior + legacy event names)

## Base event envelope

Required fields for every event:
- `v`: number
- `id`: string (SHA-256 digest over canonical event bytes, excluding `id`)
- `runId`: string
- `seq`: number (contiguous, starts at `0`)
- `type`: string
- `timestamp`: number (Unix ms)
- `payload`: object

Optional fields:
- `causes`: string[] (causal parent event IDs)
- `meta`: object
- `meta.agentId`: string
- `meta.tool`: string
- `meta.model`: string

## Event types found in source

Canonical event types from `packages/core/event.ts`:
- `run.started`
- `run.finished`
- `run.commit`
- `agent.started`
- `agent.finished`
- `model.requested`
- `model.responded`
- `tool.requested`
- `tool.responded`
- `fs.snapshot`
- `fs.diff`
- `decision.made`
- `invariant.failed`
- `budget.exhausted`

Additional type defined in `packages/core/types.ts`:
- `error.raised`

Legacy runtime type emitted by `src/cli.ts`:
- `run.start`

## Payload contract by event type

### `run.started`
Required payload fields:
- `name`: string
- `version`: string

Optional payload fields:
- none

Example payload:
```json
{
  "name": "agent-workflow",
  "version": "1.0.0"
}
```

### `run.finished`
Required payload fields:
- `status`: `"success" | "failed" | "killed"`

Optional payload fields:
- `commitHash`: string

Example payload:
```json
{
  "status": "success",
  "commitHash": "e3b0c44298fc1c149afbf4c8996fb924..."
}
```

### `run.commit`
Required payload fields:
- none

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{}
```

### `agent.started`
Required payload fields:
- none

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{
  "agentId": "planner-v1"
}
```

### `agent.finished`
Required payload fields:
- none

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{
  "status": "ok"
}
```

### `model.requested`
Required payload fields:
- none (no strict per-type payload schema in current source)

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{
  "prompt": "Summarize the latest diff",
  "model": "gpt-4"
}
```

### `model.responded`
Required payload fields:
- none (no strict per-type payload schema in current source)

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{
  "response": {
    "text": "Plan generated."
  }
}
```

### `tool.requested`
Required payload fields:
- `callId`: string
- `txId`: string
- `tool`: string
- `args`: object

Optional payload fields:
- `caps`: object
- `caps.fsRead`: boolean
- `caps.fsWrite`: boolean
- `caps.net`: boolean

Example payload:
```json
{
  "callId": "tool-01",
  "txId": "tx-01",
  "tool": "bash",
  "args": { "cmd": "ls -la" },
  "caps": { "fsRead": true, "fsWrite": false }
}
```

### `tool.responded`
Required payload fields:
- `callId`: string
- `txId`: string
- `output`: any

Optional payload fields:
- `error`: object
- `error.code`: string
- `error.message`: string
- `exitCode`: number

Example payload:
```json
{
  "callId": "tool-01",
  "txId": "tx-01",
  "output": "file listing...",
  "exitCode": 0
}
```

### `fs.snapshot`
Required payload fields:
- `workspaceHash`: string
- `files`: array of objects
- `files[].path`: string
- `files[].digest`: string
- `files[].size`: number

Optional payload fields:
- `txId`: string

Example payload:
```json
{
  "workspaceHash": "sha256:...",
  "txId": "tx-01",
  "files": [
    { "path": "src/main.ts", "digest": "abc123", "size": 1024 }
  ]
}
```

### `fs.diff`
Required payload fields:
- `txId`: string
- `path`: string
- `beforeDigest`: string
- `afterDigest`: string
- `patch`: object, one of:
  - `{ "kind": "unified", "text": string }`
  - `{ "kind": "blob", "digest": string }`

Optional payload fields:
- none

Example payload:
```json
{
  "txId": "tx-01",
  "path": "src/main.ts",
  "beforeDigest": "0a1b2c",
  "afterDigest": "1c2d3e",
  "patch": { "kind": "unified", "text": "@@ -1,1 +1,1 @@\\n-old\\n+new" }
}
```

### `decision.made`
Required payload fields:
- `rationale`: string
- `plan`: string[]

Optional payload fields:
- none

Example payload:
```json
{
  "rationale": "Need to inspect project files before edits",
  "plan": ["ls", "cat package.json", "review output"]
}
```

### `invariant.failed`
Required payload fields:
- `invariant`: string
- `message`: string
- `severity`: `"warn" | "error" | "fatal"`

Optional payload fields:
- none

Example payload:
```json
{
  "invariant": "plan_before_action",
  "message": "tool.requested must be caused by decision.made",
  "severity": "error"
}
```

### `budget.exhausted`
Required payload fields:
- none

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{
  "limit": 32000,
  "used": 32000,
  "remaining": 0
}
```

### `error.raised`
Required payload fields:
- `code`: string
- `message`: string

Optional payload fields:
- none

Example payload:
```json
{
  "code": "E_TOOL_TIMEOUT",
  "message": "Tool execution exceeded timeout"
}
```

### `run.start` (legacy runtime type)
Required payload fields:
- none

Optional payload fields:
- implementation-defined fields (object)

Example payload:
```json
{}
```

## Replay and verification invariants

- `seq` must be contiguous (`event[i].seq === i`).
- `id` must equal `sha256(canonical(event_without_id))`.
- each `causes[]` entry must reference an earlier event in the same run.
- replayed JSONL must load and verify without mutation.

## Compatibility notes

- `src/runtime/kernel.ts` accepts arbitrary event type strings and does not enforce per-type payload schemas.
- `packages/core/verify.ts` validates using `packages/core/event.ts` `EventSchema`; this currently accepts canonical event types above, but not `run.start` or `error.raised`.
- `packages/core/types.ts` is stricter for per-type payloads and includes `error.raised`.
