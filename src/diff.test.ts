import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { diffLines, formatLineDiff, truncateDiffLines, diffRuns, formatDiffMarkdown } from './diff';
import type { CognitiveEvent } from './runtime/kernel';

function makeEvent(overrides: Partial<CognitiveEvent> & { seq: number; type: string }): CognitiveEvent {
  return {
    v: 1.1,
    id: `id-${overrides.seq}`,
    runId: 'run-test',
    timestamp: 1000 + overrides.seq,
    causes: [],
    payload: {},
    ...overrides,
  };
}

describe('line diff rendering', () => {
  test('added lines are prefixed with +', () => {
    const result = diffLines(['alpha', 'bravo'], ['alpha', 'bravo', 'charlie']);
    assert.ok(result.includes('+charlie'));
  });

  test('removed lines are prefixed with -', () => {
    const result = diffLines(['alpha', 'bravo', 'charlie'], ['alpha', 'charlie']);
    assert.ok(result.includes('-bravo'));
  });

  test('modified lines include surrounding context', () => {
    const result = diffLines(
      ['one', 'two', 'three', 'four', 'five'],
      ['one', 'two', 'THREE', 'four', 'five'],
      { contextLines: 1 },
    );

    assert.deepEqual(result, [' two', '-three', '+THREE', ' four']);
  });

  test('empty diff returns empty array/string', () => {
    assert.deepEqual(diffLines('same\ncontent', 'same\ncontent'), []);
    assert.equal(formatLineDiff('same\ncontent', 'same\ncontent'), '');
  });

  test('added lines render exactly with zero context', () => {
    const result = diffLines(['line-a'], ['line-a', 'line-b'], { contextLines: 0 });
    assert.deepEqual(result, ['+line-b']);
  });

  test('removed lines render exactly with zero context', () => {
    const result = diffLines(['line-a', 'line-b'], ['line-a'], { contextLines: 0 });
    assert.deepEqual(result, ['-line-b']);
  });

  test('mixed modified+added lines include ellipsis when context is omitted', () => {
    const result = diffLines(
      ['alpha', 'beta', 'gamma'],
      ['alpha', 'BETA', 'gamma', 'delta'],
      { contextLines: 0 },
    );
    assert.deepEqual(result, ['-beta', '+BETA', '...', '+delta']);
  });

  test('binary-like lines with null bytes are diffed without throwing', () => {
    const result = diffLines(['\u0000\u0001binary'], ['\u0000\u0002binary'], { contextLines: 0 });
    assert.deepEqual(result, ['-\u0000\u0001binary', '+\u0000\u0002binary']);
  });
});

describe('large diff truncation', () => {
  test('truncateDiffLines appends marker when max is exceeded', () => {
    const lines = ['-a', '+b', '-c', '+d'];
    assert.deepEqual(truncateDiffLines(lines, 3, '[cut]'), ['-a', '+b', '[cut]']);
  });

  test('truncateDiffLines returns only marker when maxLines <= 1', () => {
    const lines = ['-a', '+b', '-c'];
    assert.deepEqual(truncateDiffLines(lines, 1, '[cut]'), ['[cut]']);
    assert.deepEqual(truncateDiffLines(lines, 0, '[cut]'), ['[cut]']);
  });

  test('formatLineDiff applies default truncation marker for large diffs', () => {
    const before = Array.from({ length: 8 }, (_, i) => `before-${i}`);
    const after = Array.from({ length: 8 }, (_, i) => `after-${i}`);
    const output = formatLineDiff(before, after, { contextLines: 0, maxLines: 3 });
    const lines = output.split('\n');

    assert.equal(lines.length, 3);
    assert.equal(lines[2], '... (truncated)');
  });

  test('formatLineDiff does not truncate when lines are within maxLines', () => {
    const output = formatLineDiff(['a'], ['b'], { contextLines: 0, maxLines: 4 });
    assert.equal(output, '-a\n+b');
  });

  test('formatLineDiff supports injectable truncation dependencies', () => {
    let truncateCalled = false;
    const output = formatLineDiff(
      ['alpha', 'beta', 'gamma'],
      ['ALPHA', 'BETA', 'GAMMA'],
      { contextLines: 0, maxLines: 2, truncationMarker: '[trimmed]' },
      {
        truncateLines: (lines, maxLines, marker) => {
          truncateCalled = true;
          assert.equal(maxLines, 2);
          assert.equal(marker, '[trimmed]');
          assert.ok(lines.length > maxLines);
          return ['custom'];
        },
        joinLines: lines => lines.join('|'),
      },
    );

    assert.equal(truncateCalled, true);
    assert.equal(output, 'custom');
  });
});

describe('binary payload handling', () => {
  test('diffRuns detects blob digest changes as modified fields', () => {
    const e1 = makeEvent({
      seq: 0,
      type: 'fs.diff',
      payload: { path: 'image.png', patch: { kind: 'blob', digest: 'sha256:old' } },
    });
    const e2 = makeEvent({
      seq: 0,
      type: 'fs.diff',
      payload: { path: 'image.png', patch: { kind: 'blob', digest: 'sha256:new' } },
    });

    const diff = diffRuns('run-a', [e1], 'run-b', [e2]);
    assert.equal(diff.modified.length, 1);
    const digestDiff = diff.modified[0].fieldDiffs.find(fd => fd.field === 'payload.patch.digest');
    assert.ok(digestDiff);
    assert.equal(digestDiff.oldValue, 'sha256:old');
    assert.equal(digestDiff.newValue, 'sha256:new');
  });

  test('formatDiffMarkdown includes binary blob digest modifications', () => {
    const e1 = makeEvent({
      seq: 0,
      type: 'fs.diff',
      payload: { path: 'image.png', patch: { kind: 'blob', digest: 'sha256:abc' } },
    });
    const e2 = makeEvent({
      seq: 0,
      type: 'fs.diff',
      payload: { path: 'image.png', patch: { kind: 'blob', digest: 'sha256:def' } },
    });

    const markdown = formatDiffMarkdown(diffRuns('run-a', [e1], 'run-b', [e2]));
    assert.ok(markdown.includes('payload.patch.digest changed "sha256:abc" → "sha256:def"'));
  });
});
