import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { diffRuns, formatDiffMarkdown } from './diff';
import { ClankaKernel, type CognitiveEvent } from './runtime/kernel';

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
