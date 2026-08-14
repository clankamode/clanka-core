# Event Schema

The event schema in [`packages/core/event.ts`](../packages/core/event.ts) defines the EventLog envelope for the in-repo `packages/core` modules (`packages/core` has no `package.json` and is not an npm workspace package).

> **Surfaces:** This document describes `EventTypeSchema` / `EventSchema` in `packages/core/event.ts`. The operator CLI and `ClankaKernel` (`src/runtime/kernel.ts`, `@clankamode/core-runtime`) use an open `string` for `type` and do **not** validate against `EventTypeSchema`. Default `clanka-core run` only appends `run.start` then `run.commit`.

## Design Overview

The schema is built around three design constraints:

- Content-addressable: each event `id` is a SHA256 digest derived from the event content rather than an externally assigned identifier.
- Causally linked: `causes` records parent event IDs so related actions form a causal graph instead of an isolated sequence.
- Immutable log: events are appended with increasing `seq` values and are intended to be preserved as a durable execution history.

This combination makes the log suitable for replay, verification, auditing, and deterministic runtime analysis.

## Event Types

`EventTypeSchema` currently **allows** these values. The “Intended use” column describes what the EventLog enum means — it is **not** a list of events the CLI emits today.

| Event type | Intended use (EventLog schema) |
| --- | --- |
| `run.started` | Record run-level startup metadata when a run begins. |
| `run.finished` | Record a run’s terminal status when it completes. |
| `run.commit` | Record a committed checkpoint or persisted milestone. |
| `agent.started` | Record that an agent began work inside a run. |
| `agent.finished` | Record that an agent completed work inside a run. |
| `model.requested` | Record that a model request was issued. |
| `model.responded` | Record that a model response was received. |
| `tool.requested` | Record that a tool call was requested. |
| `tool.responded` | Record that a tool call finished. |
| `fs.snapshot` | Record a filesystem snapshot, typically after a write transaction. |
| `fs.diff` | Record a file mutation between two digests. |
| `decision.made` | Record a planning/reasoning step that justifies later actions. |
| `invariant.failed` | Record that an invariant check detected a violation. |
| `budget.exhausted` | Record that execution stopped because a resource budget was consumed. |

### Naming note: `run.start` vs `run.started`

Do not assume these are interchangeable.

| Surface | Startup event type | Notes |
| --- | --- | --- |
| CLI + `ClankaKernel` (`src/runtime/kernel.ts`, `@clankamode/core-runtime`) | `run.start` | `clanka-core run` emits `run.start` then `run.commit`. Kernel `type` is an open string. |
| EventLog schema (`packages/core/event.ts`) | `run.started` | Enumerated by `EventTypeSchema` / `CONTRACT.md`. |
| Sample traces in `runs/` | may use either | e.g. `golden.jsonl` uses `run.started`; CLI-created runs use `run.start`. |

Operators comparing CLI output, golden fixtures, and schema docs should treat `run.start` and `run.started` as distinct labels until a migration unifies them.

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

In `packages/core/event.ts`, this is implemented by `canonicalJSON()` and `contentDigest()`. `createEvent()` digests before `meta` exists. Separately, `packages/core/kernel.ts` may attach `meta` and re-run `contentDigest()` so `id` matches the final object.

Do not assume EventLog `canonicalJSON()` and CLI/`ClankaKernel` `toCanonical()` (`src/runtime/kernel.ts`) produce identical strings for nested objects — they are different implementations.
