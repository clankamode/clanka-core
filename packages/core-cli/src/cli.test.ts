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

test('cmdReplay empty run prints explicit message and exits non-zero', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-replay-empty-'));
  const priorCwd = process.cwd();
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  const priorExit = process.exitCode;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'runs', 'empty.jsonl'), '\n', 'utf-8');

    process.env.CLANKA_CORE_CLI_TEST = '1';
    process.exitCode = 0;
    vi.resetModules();
    const { cmdReplay } = await import('./cli.js');

    const lines: string[] = [];
    const errors: string[] = [];
    cmdReplay('empty', line => lines.push(line), line => errors.push(line));

    assert.deepEqual(lines, []);
    assert.deepEqual(errors, ['No events in run empty']);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = priorExit;
    process.chdir(priorCwd);
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdLs empty runs dir prints explicit message and exits non-zero', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-ls-empty-'));
  const priorCwd = process.cwd();
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  const priorExit = process.exitCode;

  try {
    process.chdir(tempRoot);
    process.env.CLANKA_CORE_CLI_TEST = '1';
    process.exitCode = 0;
    vi.resetModules();
    const { cmdLs } = await import('./cli.js');

    const lines: string[] = [];
    const errors: string[] = [];
    cmdLs(line => lines.push(line), line => errors.push(line));

    assert.deepEqual(lines, []);
    assert.deepEqual(errors, ['No runs found in runs/']);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = priorExit;
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

test('cmdRun refuses to overwrite an existing run without --force', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-run-overwrite-'));
  const priorCwd = process.cwd();
  const prior = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdRun } = await import('./cli.js');

    const lines: string[] = [];
    await cmdRun('demo', {}, line => lines.push(line));
    assert.equal(lines[0], 'demo 2');

    await assert.rejects(
      () => cmdRun('demo'),
      /Run already exists: demo\. Re-run with --force to overwrite\./,
    );

    const forced: string[] = [];
    await cmdRun('demo', { force: true }, line => forced.push(line));
    assert.equal(forced[0], 'demo 2');
  } finally {
    process.chdir(priorCwd);
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('parseExportArgs rejects bare --format and unknown options', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { parseExportArgs } = await import('./cli.js');

    assert.deepEqual(parseExportArgs(['demo']), { runId: 'demo', format: 'json' });
    assert.deepEqual(parseExportArgs(['demo', '--format', 'markdown']), {
      runId: 'demo',
      format: 'markdown',
    });
    assert.deepEqual(parseExportArgs(['--format=markdown', 'demo']), {
      runId: 'demo',
      format: 'markdown',
    });

    assert.throws(
      () => parseExportArgs(['demo', '--format']),
      /export --format requires a value \(json or markdown\)/,
    );
    assert.throws(
      () => parseExportArgs(['demo', '--pretty']),
      /export: unknown option --pretty/,
    );
    assert.throws(
      () => parseExportArgs(['demo', 'json']),
      /export accepts only <runId> and optional --format/,
    );
    assert.throws(
      () => parseExportArgs(['demo', '--format', 'yaml']),
      /export --format must be one of: json, markdown/,
    );
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});

test('parseDiffArgs and parseRunArgs reject unknown options', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { parseDiffArgs, parseRunArgs } = await import('./cli.js');

    assert.deepEqual(parseDiffArgs(['a', 'b', '--json']), {
      runId1: 'a',
      runId2: 'b',
      jsonOutput: true,
    });
    assert.throws(() => parseDiffArgs(['a', 'b', '--yaml']), /diff: unknown option --yaml/);
    assert.throws(() => parseDiffArgs(['a', 'b', '--json=true']), /diff: unknown option --json=true/);

    assert.deepEqual(parseRunArgs(['demo', '--force']), { runId: 'demo', force: true });
    assert.throws(() => parseRunArgs(['demo', '--nope']), /run: unknown option --nope/);
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});

test('runCli rejects unknown options that used to be silently ignored', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { runCli } = await import('./cli.js');

    await assert.rejects(() => runCli(['verify', 'demo', '--strict']), /verify: unknown option --strict/);
    await assert.rejects(() => runCli(['replay', 'demo', '--verbose']), /replay: unknown option --verbose/);
    await assert.rejects(() => runCli(['ls', 'demo']), /ls accepts no arguments/);
    await assert.rejects(() => runCli(['ls', '--all']), /ls: unknown option --all/);
    await assert.rejects(
      () => runCli(['log', 'demo', 'note', '{}', 'EXTRA']),
      /log accepts only <runId> <type> <payload-json>/,
    );
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});

test('cmdExport json and markdown both order events by seq', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-export-seq-'));
  const priorCwd = process.cwd();
  const prior = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, 'runs', 'oob.jsonl'),
      [
        JSON.stringify({
          v: 1.1,
          runId: 'oob',
          seq: 1,
          type: 'later',
          timestamp: 2000,
          causes: [],
          payload: { n: 2 },
          meta: { agentId: 't' },
          id: 'bbbb',
        }),
        JSON.stringify({
          v: 1.1,
          runId: 'oob',
          seq: 0,
          type: 'earlier',
          timestamp: 1000,
          causes: [],
          payload: { n: 1 },
          meta: { agentId: 't' },
          id: 'aaaa',
        }),
      ].join('\n') + '\n',
      'utf-8',
    );

    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdExport } = await import('./cli.js');

    let jsonOut = '';
    cmdExport('oob', 'json', chunk => {
      jsonOut += chunk;
    });
    const jsonEvents = JSON.parse(jsonOut);
    assert.deepEqual(
      jsonEvents.map((event: { seq: number; type: string }) => `${event.seq}:${event.type}`),
      ['0:earlier', '1:later'],
    );

    let mdOut = '';
    cmdExport('oob', 'markdown', chunk => {
      mdOut += chunk;
    });
    assert.match(mdOut, /- \[0\] earlier[\s\S]*- \[1\] later/);
  } finally {
    process.chdir(priorCwd);
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('usage states verify scope is digest/seq/causes/v/runId/timestamps', async () => {
  const prior = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { usage } = await import('./cli.js');
    const lines: string[] = [];
    usage(line => lines.push(line));
    const text = lines.join('\n');
    assert.match(text, /digest, seq, causes, v, runId, timestamps/);
    assert.match(text, /not EventLog schema, fs snapshot, or workspaceHash/);
  } finally {
    if (prior === undefined) delete process.env.CLANKA_CORE_CLI_TEST;
    else process.env.CLANKA_CORE_CLI_TEST = prior;
  }
});
