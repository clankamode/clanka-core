import { test } from 'vitest';
import assert from 'node:assert/strict';

test('core-cli exports cmdReplay', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    const { cmdReplay } = await import('./cli.js');
    assert.equal(typeof cmdReplay, 'function');
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});
