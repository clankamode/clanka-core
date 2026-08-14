import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ClankaKernel as EventLogKernel,
  toCanonical,
  type Event,
} from './kernel.js';
import {
  ClankaKernel,
  EventLogKernel as IndexedEventLogKernel,
  toCanonical as runtimeToCanonical,
  eventLogToCanonical,
} from './index.js';

function recalcId(eventWithoutId: Omit<Event, 'id'>): string {
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}

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

describe('EventLogKernel verify', () => {
  test('verify passes for a valid causal log', async () => {
    const kernel = new EventLogKernel('run-verify-ok');
    const start = await kernel.log('run.started', { name: 'ok' }, { agentId: 'agent' });
    await kernel.log('run.finished', { status: 'done' }, { agentId: 'agent' }, [start.id]);
    const result = kernel.verify();
    assert.equal(result.valid, true);
    assert.equal(result.eventCount, 2);
  });

  test('verify throws when payload is tampered after log', async () => {
    const kernel = new EventLogKernel('run-tamper-payload');
    await kernel.log('run.started', { secret: 'original' }, { agentId: 'agent' });
    const history = kernel.getHistory();
    history[0] = { ...history[0], payload: { secret: 'altered' } };
    kernel.loadHistory(history);
    assert.throws(() => kernel.verify(), /invalid digest/);
  });

  test('verify throws on unknown cause id', async () => {
    const kernel = new EventLogKernel('run-unknown-cause');
    await kernel.log('run.finished', {}, { agentId: 'agent' }, ['missing-cause']);
    assert.throws(() => kernel.verify(), /unknown cause/);
  });

  test('verify throws on sequence gap after loadHistory', async () => {
    const kernel = new EventLogKernel('run-gap');
    await kernel.log('run.started', {}, { agentId: 'agent' });
    await kernel.log('decision.made', { step: 1 }, { agentId: 'agent' });
    await kernel.log('run.finished', {}, { agentId: 'agent' });
    const history = kernel.getHistory();
    kernel.loadHistory([history[0], history[2]]);
    assert.throws(() => kernel.verify(), /Sequence gap/);
  });
});

describe('EventLogKernel replay', () => {
  test('serialize/fromJSONL roundtrip preserves events and verify', async () => {
    const kernel = new EventLogKernel('run-rt');
    await kernel.log('run.started', { key: 'value' }, { agentId: 'agent' });
    await kernel.log('run.finished', { result: 42 }, { agentId: 'agent' });

    const restored = EventLogKernel.fromJSONL('run-rt', kernel.serialize());
    assert.deepEqual(restored.getHistory(), kernel.getHistory());
    assert.equal(restored.verify().valid, true);
    assert.equal(restored.verify().eventCount, 2);
  });

  test('loadFromFile restores history', async () => {
    const runId = 'run-load-file';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-eventlog-'));
    try {
      fs.writeFileSync(path.join(tmpDir, `${runId}.jsonl`), '', 'utf-8');
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

  test('fromJSONL ignores blank lines', async () => {
    const kernel = new EventLogKernel('run-blank');
    await kernel.log('run.started', { prompt: 'hello' }, { agentId: 'agent' });
    const restored = EventLogKernel.fromJSONL('run-blank', `\n${kernel.serialize()}\n\n`);
    assert.deepEqual(restored.getHistory(), kernel.getHistory());
  });
});

describe('EventLogKernel isolation', () => {
  test('concurrent kernels do not mix histories or ids', async () => {
    const alpha = new EventLogKernel('run-alpha');
    const beta = new EventLogKernel('run-beta');

    await Promise.all([
      Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          alpha.log('decision.made', { i }, { agentId: 'a' })
        )
      ),
      Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          beta.log('decision.made', { i }, { agentId: 'b' })
        )
      ),
    ]);

    const historyA = alpha.getHistory();
    const historyB = beta.getHistory();
    assert.equal(historyA.length, 10);
    assert.equal(historyB.length, 10);
    assert.deepEqual(
      historyA.map((e) => e.runId),
      Array.from({ length: 10 }, () => 'run-alpha')
    );
    assert.deepEqual(
      historyB.map((e) => e.runId),
      Array.from({ length: 10 }, () => 'run-beta')
    );
    for (const id of historyA.map((e) => e.id)) {
      assert.ok(!historyB.some((e) => e.id === id));
    }
    assert.equal(alpha.verify().valid, true);
    assert.equal(beta.verify().valid, true);
  });
});

describe('packages/core index published surface', () => {
  test('ClankaKernel export is the runtime kernel (verify + runtime log API)', async () => {
    const kernel = new ClankaKernel('run-index-runtime');
    await kernel.log('run.start', 'agent', { ok: true });
    assert.equal(typeof kernel.verify, 'function');
    assert.equal(typeof kernel.serialize, 'function');
    assert.equal(typeof ClankaKernel.fromJSONL, 'function');
    assert.equal(kernel.verify().valid, true);
    assert.equal(runtimeToCanonical({ z: 1, a: 2 }), '{"a":2,"z":1}');
  });

  test('EventLogKernel remains available under a distinct export name', async () => {
    const kernel = new IndexedEventLogKernel('run-index-eventlog');
    await kernel.log('run.started', { ok: true }, { agentId: 'agent' });
    assert.equal(kernel.verify().valid, true);
    assert.equal(eventLogToCanonical({ z: 1, a: 2 }), '{"a":2,"z":1}');
  });

  test('runtime and EventLog digests both bind nested payload content', async () => {
    const fixedNow = 1700000003000;
    const originalNow = Date.now;
    (Date as unknown as { now: () => number }).now = () => fixedNow;

    try {
      const runtime = new ClankaKernel('run-same');
      const eventLog = new IndexedEventLogKernel('run-same');

      const r1 = await runtime.log('decision.made', 'agent', { nested: { x: 1, y: 2 } });
      const r2 = await runtime.log('decision.made', 'agent', { nested: { x: 9, y: 2 } });
      assert.notEqual(r1.id, r2.id);

      const e1 = await eventLog.log('decision.made', { nested: { x: 1, y: 2 } }, { agentId: 'agent' });
      const e2 = await new IndexedEventLogKernel('run-same').log(
        'decision.made',
        { nested: { x: 9, y: 2 } },
        { agentId: 'agent' }
      );
      assert.notEqual(e1.id, e2.id);
    } finally {
      (Date as unknown as { now: () => number }).now = originalNow;
    }
  });
});

describe('EventLogKernel schema-typed logging', () => {
  test('accepts enumerated EventType values and records meta in digest', async () => {
    const kernel = new EventLogKernel('run-schema');
    const event = await kernel.log(
      'tool.requested',
      { tool: 'bash', args: { cmd: 'ls' } },
      { agentId: 'cli', tool: 'bash' }
    );
    assert.equal(event.type, 'tool.requested');
    assert.equal(event.meta?.tool, 'bash');
    const { id, ...withoutId } = event;
    assert.equal(id, recalcId(withoutId));
    assert.equal(kernel.verify().valid, true);
  });
});
