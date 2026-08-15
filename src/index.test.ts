import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { diffRuns, formatDiffMarkdown } from './diff';
import { ClankaKernel, type CognitiveEvent } from './runtime/kernel';

const require = createRequire(import.meta.url);
const rootPackage = require('../package.json') as {
  name: string;
  main: string;
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
};

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

test('identical runs produce no diffs', () => {
  const events: CognitiveEvent[] = [
    makeEvent({ seq: 0, type: 'run.start' }),
    makeEvent({ seq: 1, type: 'run.commit' }),
  ];
  const result = diffRuns('r1', events, 'r2', events);
  assert.equal(result.onlyInRun1.length, 0);
  assert.equal(result.onlyInRun2.length, 0);
  assert.equal(result.modified.length, 0);
});

test('extra events in run1 appear in onlyInRun1', () => {
  const shared: CognitiveEvent[] = [makeEvent({ seq: 0, type: 'run.start' })];
  const extra = makeEvent({ seq: 1, type: 'tool.call', payload: { tool: 'bash' } });
  const result = diffRuns('r1', [...shared, extra], 'r2', shared);
  assert.equal(result.onlyInRun1.length, 1);
  assert.equal(result.onlyInRun1[0].type, 'tool.call');
  assert.equal(result.onlyInRun2.length, 0);
  assert.equal(result.modified.length, 0);
});

test('extra events in run2 appear in onlyInRun2', () => {
  const shared: CognitiveEvent[] = [makeEvent({ seq: 0, type: 'run.start' })];
  const extra = makeEvent({ seq: 1, type: 'tool.result', payload: { output: 'ok' } });
  const result = diffRuns('r1', shared, 'r2', [...shared, extra]);
  assert.equal(result.onlyInRun1.length, 0);
  assert.equal(result.onlyInRun2.length, 1);
  assert.equal(result.onlyInRun2[0].type, 'tool.result');
  assert.equal(result.modified.length, 0);
});

test('payload change detected as modified event', () => {
  const e1 = makeEvent({ seq: 0, type: 'tool.call', payload: { tool: 'bash', cmd: 'ls' } });
  const e2 = makeEvent({ seq: 0, type: 'tool.call', payload: { tool: 'bash', cmd: 'pwd' } });
  const result = diffRuns('r1', [e1], 'r2', [e2]);
  assert.equal(result.modified.length, 1);
  const mod = result.modified[0];
  assert.equal(mod.seq, 0);
  assert.equal(mod.type, 'tool.call');
  const cmdDiff = mod.fieldDiffs.find(fd => fd.field === 'payload.cmd');
  assert.ok(cmdDiff, 'expected payload.cmd field diff');
  assert.equal(cmdDiff.oldValue, 'ls');
  assert.equal(cmdDiff.newValue, 'pwd');
});

test('type change detected as modified event', () => {
  const e1 = makeEvent({ seq: 0, type: 'run.start' });
  const e2 = makeEvent({ seq: 0, type: 'run.abort' });
  const result = diffRuns('r1', [e1], 'r2', [e2]);
  assert.equal(result.modified.length, 1);
  const typeDiff = result.modified[0].fieldDiffs.find(fd => fd.field === 'type');
  assert.ok(typeDiff);
  assert.equal(typeDiff.oldValue, 'run.start');
  assert.equal(typeDiff.newValue, 'run.abort');
});

test('empty runs produce no diffs', () => {
  const result = diffRuns('r1', [], 'r2', []);
  assert.equal(result.onlyInRun1.length, 0);
  assert.equal(result.onlyInRun2.length, 0);
  assert.equal(result.modified.length, 0);
});

test('nested payload fields flattened and diffed', () => {
  const e1 = makeEvent({ seq: 0, type: 'agent.think', payload: { context: { tokens: 100 } } });
  const e2 = makeEvent({ seq: 0, type: 'agent.think', payload: { context: { tokens: 200 } } });
  const result = diffRuns('r1', [e1], 'r2', [e2]);
  assert.equal(result.modified.length, 1);
  const tokenDiff = result.modified[0].fieldDiffs.find(fd => fd.field === 'payload.context.tokens');
  assert.ok(tokenDiff, 'expected nested payload.context.tokens diff');
  assert.equal(tokenDiff.oldValue, 100);
  assert.equal(tokenDiff.newValue, 200);
});

test('formatDiffMarkdown contains section headers', () => {
  const e1 = makeEvent({ seq: 0, type: 'run.start' });
  const e2 = makeEvent({ seq: 0, type: 'run.start' });
  const e3 = makeEvent({ seq: 1, type: 'only.in.run1' });
  const e4 = makeEvent({ seq: 2, type: 'only.in.run2' });
  const result = diffRuns('alpha', [e1, e3], 'beta', [e2, e4]);
  const md = formatDiffMarkdown(result);
  assert.ok(md.includes('## Run Diff: alpha vs beta'));
  assert.ok(md.includes('### Only in alpha'));
  assert.ok(md.includes('### Only in beta'));
  assert.ok(md.includes('### Modified events'));
  assert.ok(md.includes('[only.in.run1]'));
  assert.ok(md.includes('[only.in.run2]'));
});

test('formatDiffMarkdown shows _none_ for empty sections', () => {
  const events = [makeEvent({ seq: 0, type: 'run.start' })];
  const result = diffRuns('r1', events, 'r2', events);
  const md = formatDiffMarkdown(result);
  assert.equal((md.match(/_none_/g) ?? []).length, 3);
});

test('formatDiffMarkdown shows field change arrow for modified events', () => {
  const e1 = makeEvent({ seq: 0, type: 'tool.call', payload: { cmd: 'ls' } });
  const e2 = makeEvent({ seq: 0, type: 'tool.call', payload: { cmd: 'pwd' } });
  const result = diffRuns('r1', [e1], 'r2', [e2]);
  const md = formatDiffMarkdown(result);
  assert.ok(md.includes('→'), 'expected → arrow in diff output');
  assert.ok(md.includes('"ls"'));
  assert.ok(md.includes('"pwd"'));
});

test('formatDiffMarkdown renders added, removed, and modified lines', () => {
  const run1: CognitiveEvent[] = [
    makeEvent({ seq: 0, type: 'run.start', payload: { run: 'r' } }),
    makeEvent({ seq: 1, type: 'fs.added', payload: { path: 'a.txt' } }),
    makeEvent({ seq: 3, type: 'fs.changed', payload: { path: 'c.txt', hash: 'old' } }),
  ];
  const run2: CognitiveEvent[] = [
    makeEvent({ seq: 0, type: 'run.start', payload: { run: 'r' } }),
    makeEvent({ seq: 2, type: 'fs.removed', payload: { path: 'b.txt' } }),
    makeEvent({ seq: 3, type: 'fs.changed', payload: { path: 'c.txt', hash: 'new' } }),
  ];

  const md = formatDiffMarkdown(diffRuns('r1', run1, 'r2', run2));

  assert.ok(md.includes('- [fs.added] {"path":"a.txt"}'));
  assert.ok(md.includes('- [fs.removed] {"path":"b.txt"}'));
  assert.ok(md.includes('- [fs.changed]: payload.hash changed "old" → "new"'));
});

test('formatDiffMarkdown handles binary payloads', () => {
  const binaryEvent = makeEvent({
    seq: 1,
    type: 'fs.binary',
    payload: { path: 'image.png', bytes: Buffer.from([0, 255, 16, 32]) },
  });

  const md = formatDiffMarkdown(diffRuns('r1', [binaryEvent], 'r2', []));

  assert.ok(md.includes('[fs.binary]'));
  assert.ok(md.includes('"type":"Buffer"'));
  assert.ok(md.includes('"data":[0,255,16,32]'));
});

test('formatDiffMarkdown truncates long payload summaries', () => {
  const longText = 'x'.repeat(200);
  const longEvent = makeEvent({ seq: 1, type: 'tool.output', payload: { text: longText } });

  const md = formatDiffMarkdown(diffRuns('r1', [longEvent], 'r2', []));
  const outputLine = md.split('\n').find(line => line.startsWith('- [tool.output] '));

  assert.ok(outputLine, 'expected tool.output line');
  assert.ok(outputLine.endsWith('...'), 'expected truncated summary to end with ellipsis');
  assert.ok(!md.includes('x'.repeat(120)), 'expected long payload to be truncated');
});

test('cmdReplay prints relative timestamps with +0ms first line in seq order', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-replay-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const runId = 'replay-seq-check';
    const kernel = new ClankaKernel(runId);
    await kernel.log('run.start', 'test', { step: 0 });

    vi.setSystemTime(new Date('2026-03-01T00:00:00.007Z'));
    await kernel.log('run.step', 'test', { step: 1 });

    vi.setSystemTime(new Date('2026-03-01T00:00:00.015Z'));
    await kernel.log('run.end', 'test', { step: 2 });

    fs.writeFileSync(path.join(tempRoot, 'runs', `${runId}.jsonl`), kernel.serialize() + '\n', 'utf-8');

    process.env.CLANKA_CORE_CLI_TEST = '1';
    const { cmdReplay } = await import('./cli');
    const lines: string[] = [];
    cmdReplay(runId, line => lines.push(line));

    assert.equal(lines.length, 3);
    assert.match(lines[0], /^\+0ms  \[0\]  run.start  /);
    assert.deepEqual(
      lines.map(line => Number(line.match(/\[(\d+)\]/)?.[1] ?? '-1')),
      [0, 1, 2],
    );
    assert.match(lines[2], /^\+15ms  \[2\]  run.end  /);
  } finally {
    vi.useRealTimers();
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdExport emits JSON by default', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-export-json-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });

    const runId = 'export-json';
    const kernel = new ClankaKernel(runId);
    await kernel.log('run.start', 'test', { ok: true });
    fs.writeFileSync(path.join(tempRoot, 'runs', `${runId}.jsonl`), kernel.serialize() + '\n', 'utf-8');

    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdExport } = await import('./cli');

    let output = '';
    cmdExport(runId, 'json', chunk => {
      output += chunk;
    });
    const parsed = JSON.parse(output);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, 'run.start');
  } finally {
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('isHelpCommand recognizes help flags', async () => {
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';
  vi.resetModules();
  const { isHelpCommand } = await import('./cli');

  assert.equal(isHelpCommand('help'), true);
  assert.equal(isHelpCommand('--help'), true);
  assert.equal(isHelpCommand('-h'), true);
  assert.equal(isHelpCommand('ls'), false);
  assert.equal(isHelpCommand(undefined), false);

  if (priorEnv === undefined) {
    delete process.env.CLANKA_CORE_CLI_TEST;
  } else {
    process.env.CLANKA_CORE_CLI_TEST = priorEnv;
  }
});

test('usage lists help aliases', async () => {
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';
  vi.resetModules();
  const { usage } = await import('./cli');
  const lines: string[] = [];
  usage(line => lines.push(line));
  assert.match(lines.join('\n'), /help \| --help \| -h/);

  if (priorEnv === undefined) {
    delete process.env.CLANKA_CORE_CLI_TEST;
  } else {
    process.env.CLANKA_CORE_CLI_TEST = priorEnv;
  }
});

test('cmdReplay empty run prints explicit message', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-replay-empty-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  const priorExit = process.exitCode;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'runs', 'empty.jsonl'), '\n', 'utf-8');

    process.env.CLANKA_CORE_CLI_TEST = '1';
    process.exitCode = 0;
    vi.resetModules();
    const { cmdReplay } = await import('./cli');

    const lines: string[] = [];
    const errors: string[] = [];
    const ok = cmdReplay('empty', line => lines.push(line), line => errors.push(line));

    assert.equal(ok, false);
    assert.deepEqual(lines, []);
    assert.deepEqual(errors, ['No events in run empty']);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = priorExit;
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdLs empty runs dir prints explicit message', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-ls-empty-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  const priorExit = process.exitCode;

  try {
    process.chdir(tempRoot);
    process.env.CLANKA_CORE_CLI_TEST = '1';
    process.exitCode = 0;
    vi.resetModules();
    const { cmdLs } = await import('./cli');

    const lines: string[] = [];
    const errors: string[] = [];
    const ok = cmdLs(line => lines.push(line), line => errors.push(line));

    assert.equal(ok, false);
    assert.deepEqual(lines, []);
    assert.deepEqual(errors, ['No runs found in runs/']);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = priorExit;
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdLs surfaces verify failure reason', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-ls-fail-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;

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
    const { cmdLs } = await import('./cli');

    const lines: string[] = [];
    cmdLs(line => lines.push(line));

    assert.equal(lines.length, 1);
    assert.match(lines[0], /^broken-run\t1\t\d+\tFAIL \(Event 0 has invalid digest/);
  } finally {
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdExport emits markdown with event details', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-export-md-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    fs.mkdirSync(path.join(tempRoot, 'runs'), { recursive: true });

    const runId = 'export-markdown';
    const kernel = new ClankaKernel(runId);
    await kernel.log('run.start', 'test', { phase: 'init' });
    fs.writeFileSync(path.join(tempRoot, 'runs', `${runId}.jsonl`), kernel.serialize() + '\n', 'utf-8');

    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdExport } = await import('./cli');

    let output = '';
    cmdExport(runId, 'markdown', chunk => {
      output += chunk;
    });
    assert.match(output, /^# Run Export: export-markdown/m);
    assert.match(output, /Total events: 1/);
    assert.match(output, /run.start/);
    assert.match(output, /actor: test/);
    assert.match(output, /payload: {"phase":"init"}/);
  } finally {
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdExport json and markdown both order events by seq', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-export-seq-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;

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
    const { cmdExport } = await import('./cli');

    let jsonOut = '';
    cmdExport('oob', 'json', chunk => {
      jsonOut += chunk;
    });
    const jsonEvents = JSON.parse(jsonOut) as Array<{ seq: number; type: string }>;
    assert.deepEqual(
      jsonEvents.map(event => `${event.seq}:${event.type}`),
      ['0:earlier', '1:later'],
    );

    let mdOut = '';
    cmdExport('oob', 'markdown', chunk => {
      mdOut += chunk;
    });
    assert.match(mdOut, /- \[0\] earlier[\s\S]*- \[1\] later/);
  } finally {
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('cmdRun refuses to overwrite an existing run without --force', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-cli-run-overwrite-'));
  const priorCwd = process.cwd();
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;

  try {
    process.chdir(tempRoot);
    process.env.CLANKA_CORE_CLI_TEST = '1';
    vi.resetModules();
    const { cmdRun } = await import('./cli');

    const lines: string[] = [];
    await cmdRun('demo', {}, line => lines.push(line));
    assert.equal(lines[0], 'demo 2');
    assert.equal(fs.existsSync(path.join(tempRoot, 'runs', 'demo.jsonl')), true);

    await assert.rejects(
      () => cmdRun('demo'),
      /Run already exists: demo\. Re-run with --force to overwrite\./,
    );

    const forced: string[] = [];
    await cmdRun('demo', { force: true }, line => forced.push(line));
    assert.equal(forced[0], 'demo 2');
  } finally {
    process.chdir(priorCwd);
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('parseExportArgs rejects bare --format and unknown options', async () => {
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { parseExportArgs } = await import('./cli');

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
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
  }
});

test('parseDiffArgs and parseRunArgs reject unknown options', async () => {
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { parseDiffArgs, parseRunArgs } = await import('./cli');

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
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
  }
});

test('published runCli rejects unknown options that used to be silently ignored', async () => {
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';

  try {
    vi.resetModules();
    const { runCli } = await import('./cli');

    await assert.rejects(() => runCli(['verify', 'demo', '--strict']), /verify: unknown option --strict/);
    await assert.rejects(() => runCli(['replay', 'demo', '--verbose']), /replay: unknown option --verbose/);
    await assert.rejects(() => runCli(['ls', 'demo']), /ls accepts no arguments/);
    await assert.rejects(() => runCli(['ls', '--all']), /ls: unknown option --all/);
    await assert.rejects(
      () => runCli(['log', 'demo', 'note', '{}', 'EXTRA']),
      /log accepts only <runId> <type> <payload-json>/,
    );
    await assert.rejects(
      () => runCli(['export', 'demo', '--format']),
      /export --format requires a value \(json or markdown\)/,
    );
  } finally {
    if (priorEnv === undefined) {
      delete process.env.CLANKA_CORE_CLI_TEST;
    } else {
      process.env.CLANKA_CORE_CLI_TEST = priorEnv;
    }
  }
});

test('root package publish surface matches README CLI claims', async () => {
  const priorEnv = process.env.CLANKA_CORE_CLI_TEST;
  process.env.CLANKA_CORE_CLI_TEST = '1';
  vi.resetModules();
  const {
    CLI_COMMANDS,
    PUBLISHED_BIN_NAME,
    PUBLISHED_PACKAGE_NAME,
    usage,
  } = await import('./cli');

  assert.equal(rootPackage.name, PUBLISHED_PACKAGE_NAME);
  assert.equal(rootPackage.bin[PUBLISHED_BIN_NAME], 'dist/cli.js');
  assert.equal(rootPackage.main, 'dist/runtime/kernel.js');
  assert.deepEqual(rootPackage.files.slice().sort(), ['README.md', 'dist']);
  assert.match(rootPackage.scripts.changelog, /gen-changelog\.sh/);
  assert.match(rootPackage.scripts['test:packages'], /@clankamode\/core-runtime/);
  assert.match(rootPackage.scripts['test:packages'], /@clankamode\/core-cli/);

  assert.deepEqual([...CLI_COMMANDS], [
    'run',
    'log',
    'replay',
    'verify',
    'ls',
    'export',
    'diff',
  ]);

  const lines: string[] = [];
  usage(line => lines.push(line));
  const text = lines.join('\n');
  assert.match(text, new RegExp(`Usage: ${PUBLISHED_BIN_NAME} `));
  assert.match(text, new RegExp(`Package: ${PUBLISHED_PACKAGE_NAME}`));
  for (const command of CLI_COMMANDS) {
    assert.match(text, new RegExp(`\\b${command}\\b`));
  }

  assert.equal(fs.existsSync(path.resolve(__dirname, '../scripts/gen-changelog.sh')), true);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../.npmignore')), true);
  const npmignore = fs.readFileSync(path.resolve(__dirname, '../.npmignore'), 'utf8');
  assert.match(npmignore, /^!README\.md$/m);
  assert.doesNotMatch(npmignore, /^!CHANGELOG\.md$/m);
  assert.doesNotMatch(npmignore, /^tests\/$/m);

  const publishYml = fs.readFileSync(
    path.resolve(__dirname, '../.github/workflows/publish.yml'),
    'utf8',
  );
  assert.doesNotMatch(publishYml, /if:.*secrets\.NPM_TOKEN/);
  assert.match(publishYml, /env:\s*\n\s*NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(publishYml, /env\.NPM_TOKEN/);

  if (priorEnv === undefined) {
    delete process.env.CLANKA_CORE_CLI_TEST;
  } else {
    process.env.CLANKA_CORE_CLI_TEST = priorEnv;
  }
});
