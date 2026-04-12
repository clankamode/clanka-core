import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  diffLines,
  diffRuns,
  formatDiffMarkdown,
  summarizePayload,
} from './diff.js';
import type { CognitiveEvent } from './runtime/kernel.js';

function makeEvent(overrides: Partial<CognitiveEvent> & { seq: number; type: string }): CognitiveEvent {
  return {
    v: 1.1,
    id: `id-${overrides.seq}`,
    runId: 'run-pkg-diff',
    timestamp: 1000 + overrides.seq,
    causes: [],
    payload: {},
    ...overrides,
  };
}

test('diffLines surfaces added lines with + prefix', () => {
  const lines = diffLines(['keep'], ['keep', 'new'], { contextLines: 0 });
  assert.deepEqual(lines, ['+new']);
});

test('diffRuns marks same-seq events as modified when payload differs', () => {
  const e1 = makeEvent({ seq: 0, type: 'run.started', payload: { n: 1 } });
  const e2 = makeEvent({ seq: 0, type: 'run.started', payload: { n: 2 } });
  const d = diffRuns('r1', [e1], 'r2', [e2]);
  assert.equal(d.modified.length, 1);
  assert.equal(d.modified[0].seq, 0);
});

test('formatDiffMarkdown mentions both run ids', () => {
  const e = makeEvent({ seq: 0, type: 'run.started' });
  const md = formatDiffMarkdown(diffRuns('run-a', [e], 'run-b', []));
  assert.ok(md.includes('run-a'));
  assert.ok(md.includes('run-b'));
});

test('summarizePayload includes keys for plain objects', () => {
  const s = summarizePayload({ answer: 42 }, 200);
  assert.ok(s.includes('answer'));
});
