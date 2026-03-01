# CONTRACT.md

This document covers event contracts used by exported runtime modules in this repository.

# EventLog

Source: `packages/core/event.ts` + `packages/core/logger.ts`.

Event envelope (all EventLog types):
- Required fields: `v`, `id`, `runId`, `seq`, `type`, `timestamp`, `payload`
- Optional fields: `causes`, `meta.agentId`, `meta.tool`, `meta.model`

Payload contract in EventLog:
- `packages/core/event.ts` defines `payload` as `Record<string, any>`.
- Required payload fields below are therefore `none` unless explicitly stated.

## run.started
- Required fields: none
- Optional fields: any payload keys (commonly `name`, `version`)
- Example payload:
```json
{
  "name": "clanka-core",
  "version": "1.0.0"
}
```

## run.finished
- Required fields: none
- Optional fields: any payload keys (commonly `status`, `commitHash`)
- Example payload:
```json
{
  "status": "success",
  "commitHash": "abc123"
}
```

## run.commit
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "commitHash": "abc123",
  "message": "persisted run"
}
```

## agent.started
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "agentId": "planner"
}
```

## agent.finished
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "agentId": "planner",
  "status": "ok"
}
```

## model.requested
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "model": "gpt-5",
  "prompt": "Summarize the plan"
}
```

## model.responded
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "model": "gpt-5",
  "output": "Plan generated"
}
```

## tool.requested
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "tool": "bash",
  "args": {
    "cmd": "ls -la"
  }
}
```

## tool.responded
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "tool": "bash",
  "output": "ok",
  "exitCode": 0
}
```

## fs.snapshot
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "workspaceHash": "sha256:workspace",
  "files": [
    {
      "path": "src/index.ts",
      "digest": "sha256:file",
      "size": 1234
    }
  ]
}
```

## fs.diff
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "txId": "tx-1",
  "path": "src/index.ts",
  "beforeDigest": "sha256:before",
  "afterDigest": "sha256:after",
  "patch": {
    "kind": "unified",
    "text": "@@ -1,1 +1,1 @@"
  }
}
```

## decision.made
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "rationale": "Need deterministic ordering",
  "plan": [
    "normalize",
    "verify",
    "persist"
  ]
}
```

## invariant.failed
- Required fields: none
- Optional fields: any payload keys (commonly `invariant`, `message`, `severity`, `triggerEventId`)
- Example payload:
```json
{
  "invariant": "plan_before_action",
  "message": "tool.requested missing decision.made cause",
  "severity": "error",
  "triggerEventId": "evt_123"
}
```

## budget.exhausted
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "budget": "tokens",
  "remaining": 0
}
```

# ReplayHarness

Source: `packages/core/replay.ts`.

ReplayHarness consumes `Event[]` from EventLog. It does not introduce stricter payload validation than EventLog; it replays and normalizes deterministic ordering.

## run.started
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "name": "replay-run",
  "version": "1.0.0"
}
```

## decision.made
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "rationale": "tool needed",
  "plan": [
    "call tool"
  ]
}
```

## model.requested
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "model": "gpt-5",
  "prompt": "generate answer"
}
```

## model.responded
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "model": "gpt-5",
  "output": "answer"
}
```

## tool.requested
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "tool": "bash",
  "args": {
    "cmd": "echo hi"
  }
}
```

## tool.responded
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "tool": "bash",
  "output": "hi"
}
```

## invariant.failed
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "invariant": "plan_before_action",
  "message": "violation"
}
```

## run.finished
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "status": "success"
}
```

# Diff

Source: `src/diff.ts`.

Diff compares `CognitiveEvent` objects from `src/runtime/kernel.ts`, where `type` is an unconstrained `string`. No enum validation is applied.

## any-string type (CognitiveEvent.type)
- Required fields: none enforced by Diff for `payload`
- Optional fields: any payload keys
- Example payload:
```json
{
  "path": "src/file.ts",
  "before": "old",
  "after": "new"
}
```

## run.start
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{}
```

## tool.call
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "tool": "bash",
  "cmd": "ls"
}
```

## fs.changed
- Required fields: none
- Optional fields: any payload keys
- Example payload:
```json
{
  "path": "c.txt",
  "hash": "new"
}
```

# types

Source: `packages/core/types.ts`.

`types.ts` defines a stricter discriminated union than EventLog.

Event envelope (all `types.ts` events):
- Required fields: `v` (must be `1.1`), `id`, `runId`, `seq`, `timestamp`, `causes`, `type`, `payload`
- Optional fields: `meta.agentId`

## run.started
- Required fields: `name`, `version`
- Optional fields: none
- Example payload:
```json
{
  "name": "clanka-core",
  "version": "1.0.0"
}
```

## run.finished
- Required fields: `status` (`success` | `failed` | `killed`)
- Optional fields: `commitHash`
- Example payload:
```json
{
  "status": "success",
  "commitHash": "abc123"
}
```

## decision.made
- Required fields: `rationale`, `plan`
- Optional fields: none
- Example payload:
```json
{
  "rationale": "Need deterministic replay",
  "plan": [
    "sort events",
    "run invariants"
  ]
}
```

## tool.requested
- Required fields: `callId`, `txId`, `tool`, `args`
- Optional fields: `caps.fsRead`, `caps.fsWrite`, `caps.net`
- Example payload:
```json
{
  "callId": "call-1",
  "txId": "tx-1",
  "tool": "bash",
  "args": {
    "cmd": "echo ok"
  },
  "caps": {
    "fsRead": true,
    "fsWrite": false,
    "net": false
  }
}
```

## tool.responded
- Required fields: `callId`, `txId`, `output`
- Optional fields: `error.code`, `error.message`, `exitCode`
- Example payload:
```json
{
  "callId": "call-1",
  "txId": "tx-1",
  "output": "ok",
  "exitCode": 0
}
```

## fs.diff
- Required fields: `txId`, `path`, `beforeDigest`, `afterDigest`, `patch`
- Optional fields: none
- Example payload:
```json
{
  "txId": "tx-2",
  "path": "src/main.ts",
  "beforeDigest": "sha256:before",
  "afterDigest": "sha256:after",
  "patch": {
    "kind": "unified",
    "text": "@@ -1 +1 @@"
  }
}
```

## fs.snapshot
- Required fields: `workspaceHash`, `files[]` (`path`, `digest`, `size`)
- Optional fields: `txId`
- Example payload:
```json
{
  "workspaceHash": "sha256:workspace",
  "txId": "tx-2",
  "files": [
    {
      "path": "src/main.ts",
      "digest": "sha256:file",
      "size": 512
    }
  ]
}
```

## invariant.failed
- Required fields: `invariant`, `message`, `severity` (`warn` | `error` | `fatal`)
- Optional fields: none
- Example payload:
```json
{
  "invariant": "plan_before_action",
  "message": "tool.requested missing decision cause",
  "severity": "error"
}
```

## error.raised
- Required fields: `code`, `message`
- Optional fields: none
- Example payload:
```json
{
  "code": "E_TOOL",
  "message": "Tool execution failed"
}
```
