import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClankaKernel } from './kernel';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('replay: identical inputs produce identical event ids', async () => {
  const originalNow = Date.now;
  const fixedNow = 1700000003000;
  (Date as unknown as { now: () => number }).now = () => fixedNow;

  try {
    const k1 = new ClankaKernel('run-det');
    const k2 = new ClankaKernel('run-det');

    await k1.log('run.start', 'agent', { input: 'hello' });
    await k1.log('tool.call', 'agent', { tool: 'bash', cmd: 'ls' });

    await k2.log('run.start', 'agent', { input: 'hello' });
    await k2.log('tool.call', 'agent', { tool: 'bash', cmd: 'ls' });

    const h1 = k1.getHistory();
    const h2 = k2.getHistory();
    assert.equal(h1.length, h2.length);
    for (let i = 0; i < h1.length; i++) {
      assert.equal(h1[i].id, h2[i].id, `event ${i} id must match`);
    }
  } finally {
    (Date as unknown as { now: () => number }).now = originalNow;
  }
});

test('replay: serialize/fromJSONL roundtrip preserves all event fields', async () => {
  const kernel = new ClankaKernel('run-rt');
  await kernel.log('run.start', 'agent', { key: 'value' });
  await kernel.log('run.end', 'agent', { result: 42 });

  const restored = ClankaKernel.fromJSONL('run-rt', kernel.serialize());

  const original = kernel.getHistory();
  const restoredHistory = restored.getHistory();
  assert.equal(original.length, restoredHistory.length);
  for (let i = 0; i < original.length; i++) {
    assert.deepEqual(original[i], restoredHistory[i]);
  }
});

test('replay: restored kernel passes verify', async () => {
  const kernel = new ClankaKernel('run-rt-verify');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const restored = ClankaKernel.fromJSONL('run-rt-verify', kernel.serialize());
  const result = restored.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
});

test('replay: different payloads produce different event ids', async () => {
  const k1 = new ClankaKernel('run-diff');
  const k2 = new ClankaKernel('run-diff');

  const e1 = await k1.log('tool.call', 'agent', { cmd: 'ls' });
  const e2 = await k2.log('tool.call', 'agent', { cmd: 'pwd' });

  assert.notEqual(e1.id, e2.id);
});

test('replay: identical inputs with fixed timestamps produce deterministic ids', async () => {
  const originalNow = Date.now;
  const fixedNow = 1700000000000;
  (Date as unknown as { now: () => number }).now = () => fixedNow;

  try {
    const k1 = new ClankaKernel('run-fixed-det');
    const k2 = new ClankaKernel('run-fixed-det');

    await k1.log('run.start', 'agent', { prompt: 'hello' });
    await k1.log('tool.requested', 'agent', { tool: 'bash', cmd: 'ls' });

    await k2.log('run.start', 'agent', { prompt: 'hello' });
    await k2.log('tool.requested', 'agent', { tool: 'bash', cmd: 'ls' });

    const h1 = k1.getHistory();
    const h2 = k2.getHistory();

    assert.equal(h1.length, h2.length);
    for (let i = 0; i < h1.length; i++) {
      assert.equal(h1[i].id, h2[i].id, `event ${i} id must match`);
      assert.equal(h1[i].timestamp, fixedNow);
    }
  } finally {
    (Date as unknown as { now: () => number }).now = originalNow;
  }
});

test('replay: deterministic serialization from replay', async () => {
  const kernel = new ClankaKernel('run-replay-determinism');
  await kernel.log('run.start', 'agent', { goal: 'verify' });
  await kernel.log('decision.made', 'agent', { rationale: 'replay test' });
  await kernel.log('tool.requested', 'agent', { tool: 'bash', cmd: 'echo' });

  const replayA = ClankaKernel.fromJSONL('run-replay-determinism', kernel.serialize());
  const replayB = ClankaKernel.fromJSONL('run-replay-determinism', kernel.serialize());

  assert.equal(replayA.serialize(), replayB.serialize());
  assert.deepEqual(replayA.getHistory(), replayB.getHistory());
  assert.equal(replayA.verify().eventCount, replayB.verify().eventCount);
});

test('replay: payload key order does not change ids', async () => {
  const fixedNow = 1700000001000;
  const originalNow = Date.now;
  (Date as unknown as { now: () => number }).now = () => fixedNow;

  try {
    const k1 = new ClankaKernel('run-key-order');
    const k2 = new ClankaKernel('run-key-order');

    await k1.log('run.start', 'agent', { b: 2, a: 1, nested: { y: 1, x: 2 } });
    await k2.log('run.start', 'agent', { a: 1, b: 2, nested: { x: 2, y: 1 } });

    const [h1, h2] = [k1.getHistory(), k2.getHistory()];
    assert.equal(h1.length, 1);
    assert.equal(h2.length, 1);
    assert.equal(h1[0].id, h2[0].id);
    assert.equal(h1[0].timestamp, fixedNow);
    assert.equal(h2[0].timestamp, fixedNow);
  } finally {
    (Date as unknown as { now: () => number }).now = originalNow;
  }
});

test('replay: repeated serialize calls are stable for unchanged history', async () => {
  const kernel = new ClankaKernel('run-serialize-stable');
  await kernel.log('run.start', 'agent', { attempt: 1 });
  await kernel.log('run.end', 'agent', { status: 'ok' });

  const s1 = kernel.serialize();
  const s2 = kernel.serialize();
  const s3 = kernel.serialize();

  assert.equal(s1, s2);
  assert.equal(s2, s3);
});

test('replay: fromJSONL ignores surrounding blank lines', async () => {
  const kernel = new ClankaKernel('run-jsonl-blank-lines');
  await kernel.log('run.start', 'agent', { prompt: 'hello' });
  await kernel.log('run.end', 'agent', { status: 'ok' });

  const jsonl = `\n${kernel.serialize()}\n\n`;
  const restored = ClankaKernel.fromJSONL('run-jsonl-blank-lines', jsonl);

  assert.deepEqual(restored.getHistory(), kernel.getHistory());
  assert.equal(restored.verify().valid, true);
});

test('replay: loadFromFile restores deterministic history', async () => {
  const runId = 'run-load-from-file';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-core-'));
  const runsDir = path.join(tmpDir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  try {
    const kernel = new ClankaKernel(runId);
    await kernel.log('run.start', 'agent', { source: 'disk' });
    await kernel.log('run.end', 'agent', { source: 'disk' });

    fs.writeFileSync(path.join(runsDir, `${runId}.jsonl`), `${kernel.serialize()}\n`, 'utf-8');

    const loaded = ClankaKernel.loadFromFile(runId, runsDir);
    assert.deepEqual(loaded.getHistory(), kernel.getHistory());
    assert.equal(loaded.verify().valid, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
