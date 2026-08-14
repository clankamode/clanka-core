import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  EventSchema,
  StrictEventSchema,
  StrictEventTypeSchema,
  StrictPayloadSchemas,
} from './types';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    v: 1.1 as const,
    id: 'evt-1',
    runId: 'run-strict',
    seq: 0,
    timestamp: 1_700_000_000_000,
    causes: [] as string[],
    ...overrides,
  };
}

describe('types.ts StrictEventSchema (CONTRACT.md strict matrix)', () => {
  test('StrictEventTypeSchema matches the CONTRACT strict matrix', () => {
    const expected = [
      'run.started',
      'run.finished',
      'decision.made',
      'tool.requested',
      'tool.responded',
      'fs.diff',
      'fs.snapshot',
      'invariant.failed',
      'error.raised',
    ];

    assert.deepEqual(Object.keys(StrictPayloadSchemas).sort(), [...expected].sort());
    for (const type of expected) {
      assert.equal(StrictEventTypeSchema.safeParse(type).success, true);
    }
    assert.equal(StrictEventTypeSchema.safeParse('run.commit').success, false);
    assert.equal(StrictEventTypeSchema.safeParse('budget.exhausted').success, false);
    assert.equal(StrictEventTypeSchema.safeParse('run.start').success, false);
  });

  test('CONTRACT EventSchema alias points at StrictEventSchema', () => {
    assert.equal(EventSchema, StrictEventSchema);
  });

  test('is a distinct schema from EventLog EventSchema (rejects CLI run.start)', () => {
    const parsed = StrictEventSchema.safeParse(
      envelope({ type: 'run.start', payload: {} }),
    );
    assert.equal(parsed.success, false);
  });

  test('accepts CONTRACT example payloads for each strict type', () => {
    const examples: Array<{ type: string; payload: Record<string, unknown> }> = [
      { type: 'run.started', payload: { name: 'clanka-core', version: '1.0.0' } },
      { type: 'run.finished', payload: { status: 'success', commitHash: 'abc123' } },
      {
        type: 'decision.made',
        payload: { rationale: 'Need deterministic replay', plan: ['sort events', 'run invariants'] },
      },
      {
        type: 'tool.requested',
        payload: {
          callId: 'call-1',
          txId: 'tx-1',
          tool: 'bash',
          args: { cmd: 'echo ok' },
          caps: { fsRead: true, fsWrite: false, net: false },
        },
      },
      {
        type: 'tool.responded',
        payload: { callId: 'call-1', txId: 'tx-1', output: 'ok', exitCode: 0 },
      },
      {
        type: 'fs.diff',
        payload: {
          txId: 'tx-2',
          path: 'src/main.ts',
          beforeDigest: 'sha256:before',
          afterDigest: 'sha256:after',
          patch: { kind: 'unified', text: '@@ -1 +1 @@' },
        },
      },
      {
        type: 'fs.snapshot',
        payload: {
          workspaceHash: 'sha256:workspace',
          txId: 'tx-2',
          files: [{ path: 'src/main.ts', digest: 'sha256:file', size: 512 }],
        },
      },
      {
        type: 'invariant.failed',
        payload: {
          invariant: 'plan_before_action',
          message: 'tool.requested missing decision cause',
          severity: 'error',
        },
      },
      { type: 'error.raised', payload: { code: 'E_TOOL', message: 'Tool execution failed' } },
    ];

    for (const example of examples) {
      const parsed = StrictEventSchema.safeParse(envelope(example));
      assert.equal(parsed.success, true, `expected ${example.type} to parse`);
    }
  });

  test('rejects missing required payload fields claimed by CONTRACT', () => {
    const cases: Array<{ type: string; payload: Record<string, unknown> }> = [
      { type: 'run.started', payload: { name: 'missing-version' } },
      { type: 'run.finished', payload: {} },
      { type: 'decision.made', payload: { rationale: 'no plan' } },
      { type: 'tool.requested', payload: { tool: 'bash', args: {} } },
      { type: 'tool.responded', payload: { callId: 'c', output: 'x' } },
      { type: 'fs.diff', payload: { path: 'a', beforeDigest: 'b', afterDigest: 'c' } },
      { type: 'fs.snapshot', payload: { files: [] } },
      { type: 'invariant.failed', payload: { invariant: 'x', message: 'y' } },
      { type: 'error.raised', payload: { code: 'E' } },
    ];

    for (const example of cases) {
      const parsed = StrictEventSchema.safeParse(envelope(example));
      assert.equal(parsed.success, false, `expected ${example.type} to reject`);
    }
  });

  test('rejects EventLog-only types that are outside the strict union', () => {
    const parsed = StrictEventSchema.safeParse(
      envelope({ type: 'run.commit', payload: { commitHash: 'abc' } }),
    );
    assert.equal(parsed.success, false);
  });

  test('requires envelope v=1.1 and causes[]', () => {
    const base = {
      type: 'run.started' as const,
      payload: { name: 'n', version: '1' },
      id: 'evt-1',
      runId: 'run-strict',
      seq: 0,
      timestamp: 1,
    };

    assert.equal(StrictEventSchema.safeParse({ ...base, v: 1.0, causes: [] }).success, false);
    assert.equal(StrictEventSchema.safeParse({ ...base, v: 1.1 }).success, false);
    assert.equal(StrictEventSchema.safeParse({ ...base, v: 1.1, causes: [] }).success, true);
  });
});
