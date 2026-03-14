# Event Schema

The event schema in [`packages/core/event.ts`](../packages/core/event.ts) defines the immutable event envelope used across `clanka-core`.

## Design Overview

The schema is built around three design constraints:

- Content-addressable: each event `id` is a SHA256 digest derived from the event content rather than an externally assigned identifier.
- Causally linked: `causes` records parent event IDs so related actions form a causal graph instead of an isolated sequence.
- Immutable log: events are appended with increasing `seq` values and are intended to be preserved as a durable execution history.

This combination makes the log suitable for replay, verification, auditing, and deterministic runtime analysis.

## Event Types

`EventTypeSchema` currently allows these values:

| Event type | When it is emitted |
| --- | --- |
| `run.started` | When a run begins and the runtime wants to record run-level startup metadata. |
| `run.finished` | When a run completes and the runtime records its terminal status. |
| `run.commit` | When a run reaches a committed checkpoint or persisted milestone. |
| `agent.started` | When an agent begins work inside a run. |
| `agent.finished` | When an agent completes its work inside a run. |
| `model.requested` | When the runtime issues a model request. |
| `model.responded` | When a model response is received and logged. |
| `tool.requested` | When the runtime requests execution of a tool call. |
| `tool.responded` | When a tool call finishes and its result is logged. |
| `fs.snapshot` | When the runtime records a filesystem snapshot, typically after a write transaction. |
| `fs.diff` | When the runtime records a file mutation between two digests. |
| `decision.made` | When an agent records a deliberate planning or reasoning step that justifies later actions. |
| `invariant.failed` | When an invariant check detects a policy or consistency violation. |
| `budget.exhausted` | When execution stops because a resource budget is consumed. |

## Event Envelope

`EventSchema` defines this structure:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `v` | `number` | Yes | Schema version for the event envelope. |
| `id` | `string` | Yes | Content-derived digest ID for the event. |
| `runId` | `string` | Yes | Identifier for the root run that owns the event. |
| `seq` | `number` | Yes | Monotonic sequence number within the run. |
| `type` | `EventType` | Yes | Event category from `EventTypeSchema`. |
| `timestamp` | `number` | Yes | Unix timestamp in milliseconds. |
| `causes` | `string[]` | No | Zero or more causal parent event IDs. |
| `payload` | `Record<string, any>` | Yes | Event-specific data. The envelope requires an object, but individual payload keys depend on the event type. |
| `meta` | `object` | No | Optional execution metadata attached to the event. |

### `meta` Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `meta.agentId` | `string` | No | Agent identity associated with the event. |
| `meta.tool` | `string` | No | Tool name associated with the event. |
| `meta.model` | `string` | No | Model name associated with the event. |

## Example

```json
{
  "v": 1.1,
  "id": "6c71f5e0bc7f2c72db9f78b33c95b67bcdf2c6e1b9d11157a6df8f3a9b97b524",
  "runId": "run-2026-03-14-001",
  "seq": 4,
  "type": "tool.requested",
  "timestamp": 1773518400000,
  "causes": [
    "0c3ef3a3f2b1d2f8d1845f24d98d5e634ce68ed7f18a9d2471c92234e6f8d1aa"
  ],
  "payload": {
    "callId": "call-7",
    "txId": "tx-call-7",
    "tool": "bash",
    "args": {
      "cmd": "npm test"
    }
  },
  "meta": {
    "agentId": "cli",
    "tool": "bash",
    "model": "gpt-5"
  }
}
```

## Digest Computation

Event digests are computed in two steps:

1. Serialize the event as canonical JSON with sorted keys.
2. Compute the SHA256 hash of that canonical JSON string.

In `packages/core/event.ts`, this is implemented by `canonicalJSON()` and `contentDigest()`. When optional `meta` is added after event creation, the event is re-digested so `id` still matches the final serialized content.
