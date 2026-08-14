import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  diffLines,
  diffRuns,
  formatDiffMarkdown,
  formatLineDiff,
  summarizePayload,
  truncateDiffLines,
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

test('truncateDiffLines appends marker when max is exceeded', () => {
  const lines = ['-a', '+b', '-c', '+d'];
  assert.deepEqual(truncateDiffLines(lines, 3, '[cut]'), ['-a', '+b', '[cut]']);
});

test('formatLineDiff applies maxLines truncation', () => {
  const before = Array.from({ length: 6 }, (_, i) => `before-${i}`);
  const after = Array.from({ length: 6 }, (_, i) => `after-${i}`);
  const output = formatLineDiff(before, after, {
    contextLines: 0,
    maxLines: 3,
    truncationMarker: '... (truncated)',
  });
  const lines = output.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[2], '... (truncated)');
});

test('diffLines does not honor maxLines; truncation is formatLineDiff-only', () => {
  const lines = diffLines(['a'], ['a', 'b', 'c'], {
    contextLines: 0,
    // Runtime callers may pass excess fields; diffLines must ignore them.
    maxLines: 1,
  } as Parameters<typeof diffLines>[2]);
  assert.deepEqual(lines, ['+b', '+c']);
});
