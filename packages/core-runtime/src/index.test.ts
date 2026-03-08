import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClankaKernel, diffRuns } from './index.js';

test('core-runtime exports kernel + diff utils', async () => {
  const kernel = new ClankaKernel('pkg-runtime-smoke');
  await kernel.log('run.start', 'test', {});
  const history = kernel.getHistory();
  const diff = diffRuns('a', history, 'b', history);

  assert.equal(history.length, 1);
  assert.equal(diff.modified.length, 0);
});
