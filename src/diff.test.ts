import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { diffLines, formatLineDiff, truncateDiffLines } from './diff';

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
});

describe('large diff truncation', () => {
  test('truncateDiffLines appends marker when max is exceeded', () => {
    const lines = ['-a', '+b', '-c', '+d'];
    assert.deepEqual(truncateDiffLines(lines, 3, '[cut]'), ['-a', '+b', '[cut]']);
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
