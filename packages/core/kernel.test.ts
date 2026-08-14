import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventLogKernel, toCanonical, type Event } from './kernel.js';
import * as coreIndex from './index.js';

function recalcId(eventWithoutId: Omit<Event, 'id'>): string {
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}

describe('packages/core index surface (not a published package)', () => {
  test('does not export ClankaKernel — operators get that from src/runtime', () => {
    assert.equal('ClankaKernel' in coreIndex, false);
    assert.equal(typeof coreIndex.EventLogKernel, 'function');
    assert.equal(typeof coreIndex.verifyRun, 'function');
  });

  test('EventLogKernel.verify is digest/seq/causes only (clanka-core verify contract)', async () => {
    const kernel = new coreIndex.EventLogKernel('run-index-verify');
    const start = await kernel.log('run.started', { ok: true }, { agentId: 'agent' });
    await kernel.log('run.finished', { ok: true }, { agentId: 'agent' }, [start.id]);
    const result = kernel.verify();
    assert.equal(result.valid, true);
    assert.equal(result.eventCount, 2);
  });
});

describe('EventLogKernel digest integrity', () => {
  test('different payloads produce different event ids', async () => {
    const fixedNow = 1700000000000;
    const originalNow = Date.now;
    (Date as unknown as { now: () => number }).now = () => fixedNow;

    try {
      const k1 = new EventLogKernel('run-payload-a');
      const k2 = new EventLogKernel('run-payload-a');
      const e1 = await k1.log('tool.requested', { cmd: 'ls' }, { agentId: 'agent' });
      const e2 = await k2.log('tool.requested', { cmd: 'rm -rf /' }, { agentId: 'agent' });
      assert.notEqual(e1.id, e2.id);
    } finally {
      (Date as unknown as { now: () => number }).now = originalNow;
    }
  });

  test('nested payload key order does not change ids', async () => {
    const fixedNow = 1700000001000;
    const originalNow = Date.now;
    (Date as unknown as { now: () => number }).now = () => fixedNow;

    try {
      const k1 = new EventLogKernel('run-key-order');
      const k2 = new EventLogKernel('run-key-order');
      await k1.log('decision.made', { b: 2, a: 1, nested: { y: 1, x: 2 } }, { agentId: 'a' });
      await k2.log('decision.made', { a: 1, b: 2, nested: { x: 2, y: 1 } }, { agentId: 'a' });
      assert.equal(k1.getHistory()[0].id, k2.getHistory()[0].id);
    } finally {
      (Date as unknown as { now: () => number }).now = originalNow;
    }
  });

  test('toCanonical sorts nested keys recursively', () => {
    assert.equal(
      toCanonical({ b: { y: 1, x: 2 }, a: 'hello' }),
      '{"a":"hello","b":{"x":2,"y":1}}',
    );
  });
});

describe('EventLogKernel.verify (operator-aligned contract)', () => {
  test('passes for a valid causal log', async () => {
    const kernel = new EventLogKernel('run-verify-ok');
    const start = await kernel.log('run.started', { name: 'ok' }, { agentId: 'agent' });
    await kernel.log('run.finished', { status: 'done' }, { agentId: 'agent' }, [start.id]);
    assert.equal(kernel.verify().valid, true);
  });

  test('throws when payload is tampered after log', async () => {
    const kernel = new EventLogKernel('run-tamper-payload');
    await kernel.log('run.started', { secret: 'original' }, { agentId: 'agent' });
    const history = kernel.getHistory();
    history[0] = { ...history[0], payload: { secret: 'altered' } };
    kernel.loadHistory(history);
    assert.throws(() => kernel.verify(), /invalid digest/);
  });

  test('throws on unknown cause id', async () => {
    const kernel = new EventLogKernel('run-unknown-cause');
    await kernel.log('run.finished', {}, { agentId: 'agent' }, ['missing-cause']);
    assert.throws(() => kernel.verify(), /unknown cause/);
  });
});

describe('EventLogKernel replay + isolation', () => {
  test('serialize/fromJSONL roundtrip then verify', async () => {
    const kernel = new EventLogKernel('run-rt');
    await kernel.log('run.started', { key: 'value' }, { agentId: 'agent' });
    await kernel.log('run.finished', { result: 42 }, { agentId: 'agent' });
    const restored = EventLogKernel.fromJSONL('run-rt', kernel.serialize());
    assert.deepEqual(restored.getHistory(), kernel.getHistory());
    assert.equal(restored.verify().valid, true);
  });

  test('loadFromFile restores history', async () => {
    const runId = 'run-load-file';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-eventlog-'));
    try {
      const kernel = new EventLogKernel(runId);
      await kernel.log('run.started', { source: 'disk' }, { agentId: 'agent' });
      fs.writeFileSync(path.join(tmpDir, `${runId}.jsonl`), kernel.serialize() + '\n', 'utf-8');
      const loaded = EventLogKernel.loadFromFile(runId, tmpDir);
      assert.deepEqual(loaded.getHistory(), kernel.getHistory());
      assert.equal(loaded.verify().valid, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('concurrent kernels do not mix histories', async () => {
    const alpha = new EventLogKernel('run-alpha');
    const beta = new EventLogKernel('run-beta');
    await Promise.all([
      Promise.all(Array.from({ length: 8 }, (_, i) => alpha.log('decision.made', { i }, { agentId: 'a' }))),
      Promise.all(Array.from({ length: 8 }, (_, i) => beta.log('decision.made', { i }, { agentId: 'b' }))),
    ]);
    assert.deepEqual(alpha.getHistory().map((e) => e.runId), Array.from({ length: 8 }, () => 'run-alpha'));
    assert.deepEqual(beta.getHistory().map((e) => e.runId), Array.from({ length: 8 }, () => 'run-beta'));
    assert.equal(alpha.verify().valid, true);
    assert.equal(beta.verify().valid, true);
  });
});

describe('EventLogKernel schema-typed logging', () => {
  test('meta is included in digest', async () => {
    const kernel = new EventLogKernel('run-schema');
    const event = await kernel.log(
      'tool.requested',
      { tool: 'bash', args: { cmd: 'ls' } },
      { agentId: 'cli', tool: 'bash' }
    );
    const { id, ...withoutId } = event;
    assert.equal(id, recalcId(withoutId));
    assert.equal(kernel.verify().valid, true);
  });
});
