# DAR v1.1 Contract

This document defines the deterministic execution guarantees and data integrity protocol for the Clanka Deterministic Agent Runtime (DAR).

## 1. The Core Guarantee

### What is Proven
- **Immutability**: Every cognitive event is part of an append-only, content-addressed log.
- **Causality**: Events are explicitly linked via `causes[]`. Forward-referencing or cyclic causality is prohibited.
- **Integrity**: Every event's `id` is a cryptographic digest of its contents. Any tampering with payloads, timestamps, or sequences invalidates the chain.
- **FS Replayability**: File mutations are recorded as atomic `fs.diff` operations. A verifier starting from an empty state must arrive at the same `workspaceHash` by replaying the log.

### What is Not Promised
- **LLM Output Determinism**: We do not guarantee the same model will produce the same text. We guarantee that *what the model produced* is recorded accurately and cannot be altered after the fact.
- **Temporal Alignment**: While timestamps are recorded, DAR ensures sequence integrity, not wall-clock precision.

## 2. Identity & Canonicalization

### Digest Identity Rule
The `id` of an event must be the SHA256 hex digest of its canonical JSON representation **excluding the `id` field itself**.

### Canonicalization Rules
1.  **Key Sorting**: All object keys must be sorted lexicographically.
2.  **No Whitespace**: The JSON must be serialized with zero indentation or extra spaces.
3.  **UTF-8**: Encoding must be strict UTF-8.

## 3. Log Policy (v1.1)

- **Schema**: Version 1.1 strictly requires `v`, `seq`, `runId`, `type`, `timestamp`, `payload`, and `causes`.
- **Monotonicity**: `seq` must start at `0` and increment by exactly `1` per event.
- **Causal DAG**: Every `causeId` in `causes[]` must refer to a previous event in the same log.

## 4. Threat Model

- **Boundary**: The DAR verifier acts as a trusted auditor.
- **Tamper Evidence**: Any modification to a `.jsonl` trace by an external process (or a rogue agent attempting to "gaslight" history) is detectable via digest mismatch or sequence gaps.
- **Strict Mode**: In strict mode, a log is only valid if it terminates with a `run.commit` event containing a valid rolling hash of the entire sequence.

## 5. Sample Trace (5-event JSONL)

```json
{"v":1.1,"runId":"test-123","seq":0,"type":"run.started","timestamp":1708383200000,"payload":{},"causes":[],"id":"..."}
{"v":1.1,"runId":"test-123","seq":1,"type":"decision.made","timestamp":1708383201000,"payload":{"thought":"Check directory"},"causes":[...],"id":"..."}
{"v":1.1,"runId":"test-123","seq":2,"type":"tool.requested","timestamp":1708383202000,"payload":{"tool":"ls"},"causes":[...],"id":"..."}
{"v":1.1,"runId":"test-123","seq":3,"type":"tool.responded","timestamp":1708383203000,"payload":{"files":["src/"]},"causes":[...],"id":"..."}
{"v":1.1,"runId":"test-123","seq":4,"type":"run.finished","timestamp":1708383204000,"payload":{"status":"success"},"causes":[...],"id":"..."}
```
