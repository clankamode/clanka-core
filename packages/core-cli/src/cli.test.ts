import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClankaKernel } from '@clankamode/core-runtime';

test('core-cli exports cmdReplay', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { cmdReplay } = await import('./cli.js');
    assert.equal(typeof cmdReplay, 'function');
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});

test('isHelpCommand recognizes help flags', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { isHelpCommand } = await import('./cli.js');
    assert.equal(isHelpCommand('--help'), true);
    assert.equal(isHelpCommand('-h'), true);
    assert.equal(isHelpCommand('help'), true);
    assert.equal(isHelpCommand('verify'), false);
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});

test('cmdLs empty runs dir prints explicit message', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-ls-empty-'));
  const priorCwd = process.cwd();
  const prior = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdLs } = await import('./cli.js');

    const lines: string[] = [];
    const errors: string[] = [];
    cmdLs(line => lines.push(line), line => errors.push(line));

    assert.deepEqual(lines, []);
    assert.deepEqual(errors, ['No runs found in runs/']);
  } finally {
    process.chdir(priorCwd);
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdLs surfaces verify failure reason', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-ls-fail-'));
  const priorCwd = process.cwd();
  const prior = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });

    const runId = 'broken-run';
    const kernel = new ClankaKernel(runId);
    await kernel.log('run.start', 'test', { ok: true });
    const history = kernel.getHistory();
    history[0].payload = { ok: false };
    fs.writeFileSync(
      path.join(tempRoot, 'runs', `${runId}.jsonl`),
      history.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf-8',
    );

    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdLs } = await import('./cli.js');

    const lines: string[] = [];
    cmdLs(line => lines.push(line));

    assert.equal(lines.length, 1);
    assert.match(lines[0], /^broken-run\t1\t\d+\tFAIL \(Event 0 has invalid digest/);
  } finally {
    process.chdir(priorCwd);
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
