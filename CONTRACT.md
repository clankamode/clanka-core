# Runtime Event Contract (`src/runtime`)

This contract is derived from the code in `src/runtime/kernel.ts`, `src/runtime/kernel.test.ts`, and `src/runtime/kernel.vitest.test.ts`.

## 1. Event Envelope Schema

`ClankaKernel.log(type, agentId, payload, causes)` emits this envelope:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `v` | yes | `number` | Runtime currently emits `1.1`. |
| `id` | yes | `string` | SHA-256 digest (hex) of canonical event JSON excluding `id`. |
| `runId` | yes | `string` | Run/session identifier from kernel constructor. |
| `seq` | yes | `number` | Monotonic, zero-based index in append order. |
| `type` | yes | `string` | No enum validation in `src/runtime`; any string is accepted. |
| `timestamp` | yes | `number` | Unix epoch milliseconds from `Date.now()`. |
| `causes` | yes (on emitted events) | `string[]` | Causal parent event IDs; defaults to `[]`. |
| `payload` | yes | `any` | Unvalidated payload value. |
| `meta` | optional | `{ agentId?: string }` | Runtime logger sets `meta.agentId` from `agentId` argument. |

## 2. Runtime Integrity Rules (`verify()`)

`verify()` enforces:

1. `id` must match the recomputed digest of event content.
2. `seq` must be contiguous (`0..N-1`) with no gaps.
3. Every `cause` must reference a prior event ID in the same history.
4. Forward/self references in `causes` are invalid.

## 3. Event Types Found In `src/runtime`

The runtime has an open string `type`, but these are all event types used in `src/runtime/*`.

### `run.start`
- Required payload fields: none.
- Optional payload fields seen in tests: `step`, `msg`, `input`, `key`, `prompt`, `run`, `data`, `secret`.
- Example payload:
```json
{}
```

### `run.end`
- Required payload fields: none.
- Optional payload fields seen in tests: `step`, `msg`, `result`, `output`, `status`, `run`.
- Example payload:
```json
{ "status": "ok" }
```

### `tool.call`
- Required payload fields: none.
- Optional payload fields seen in tests: `tool`, `cmd`.
- Example payload:
```json
{ "tool": "bash", "cmd": "ls -la" }
```

### `agent.think`
- Required payload fields: none.
- Optional payload fields seen in tests: `step`.
- Example payload:
```json
{ "step": 1 }
```

### `agent.step`
- Required payload fields: none.
- Optional payload fields seen in tests: `run`, `i`.
- Example payload:
```json
{ "run": "A", "i": 0 }
```

### `run.middle`
- Required payload fields: none.
- Optional payload fields seen in tests: none.
- Example payload:
```json
{}
```

### `step.one`
- Required payload fields: none.
- Optional payload fields seen in tests: none.
- Example payload:
```json
{}
```

### `test.event`
- Required payload fields: none.
- Optional payload fields seen in tests: `data`.
- Example payload:
```json
{ "data": "value" }
```

### `invariant.failed`
- Emitted internally by `ClankaKernel.enforceInvariants()` when an invariant check returns `valid: false`.
- Required payload fields: `invariant` (`string`), `message` (`string`).
- Optional payload fields: `severity` (any).
- Special envelope behavior:
1. `meta.agentId` is set to `"kernel"`.
2. `causes` contains the triggering event ID.
- Example payload:
```json
{
  "invariant": "no-forward-causes",
  "message": "Cause points to future event",
  "severity": "error"
}
```

### `run.started` (validation fixture in tests)
- Used only in `kernel.vitest.test.ts` to test external `EventSchema` parsing behavior.
- Runtime itself does not reserve this string; it is accepted as any other string type.
- Required payload fields in runtime: none.
- Example payload:
```json
{}
```

### `runtime.unknown` (invalid-schema fixture in tests)
- Used only in `kernel.vitest.test.ts` as an intentionally invalid enum value for external `EventSchema` tests.
- Runtime itself still accepts it because `src/runtime` does not enforce a `type` enum.
- Required payload fields in runtime: none.
- Example payload:
```json
{}
```

## 4. Canonical Event Example

```json
{
  "v": 1.1,
  "id": "3e8d3f2f5c8f3df2a3bc6f0ef94ac7e9f9f2d67db1c41d6f8cbca7c5f021a111",
  "runId": "run-123",
  "seq": 0,
  "type": "run.start",
  "timestamp": 1767225600000,
  "causes": [],
  "payload": {},
  "meta": { "agentId": "cli" }
}
```
