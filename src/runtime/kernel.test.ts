import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCanonical, ClankaKernel } from './kernel';
import type { CognitiveEvent } from './kernel';
import { EventSchema } from '../../packages/core/event';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// toCanonical()
// ---------------------------------------------------------------------------

test('toCanonical: null', () => {
  assert.equal(toCanonical(null), 'null');
});

test('toCanonical: primitives', () => {
  assert.equal(toCanonical(42), '42');
  assert.equal(toCanonical('hello'), '"hello"');
  assert.equal(toCanonical(true), 'true');
  assert.equal(toCanonical(false), 'false');
});

test('toCanonical: object keys are sorted', () => {
  assert.equal(toCanonical({ z: 1, a: 2, m: 3 }), '{"a":2,"m":3,"z":1}');
});

test('toCanonical: nested objects have keys sorted recursively', () => {
  assert.equal(
    toCanonical({ b: { y: 1, x: 2 }, a: 'hello' }),
    '{"a":"hello","b":{"x":2,"y":1}}'
  );
});

test('toCanonical: arrays preserve element order', () => {
  assert.equal(toCanonical([3, 1, 2]), '[3,1,2]');
});

test('toCanonical: array with mixed types and nested object', () => {
  assert.equal(
    toCanonical([null, 1, 'two', { b: 2, a: 1 }]),
    '[null,1,"two",{"a":1,"b":2}]'
  );
});

test('toCanonical: undefined values are omitted from objects', () => {
  assert.equal(toCanonical({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
});

test('toCanonical: empty object', () => {
  assert.equal(toCanonical({}), '{}');
});

test('toCanonical: empty array', () => {
  assert.equal(toCanonical([]), '[]');
});

test('toCanonical: object insertion order does not affect output', () => {
  const a = { x: 1, y: 2 };
  const b = { y: 2, x: 1 };
  assert.equal(toCanonical(a), toCanonical(b));
});

// ---------------------------------------------------------------------------
// Event ordering invariants
// ---------------------------------------------------------------------------

test('log: seq numbers are strictly increasing from 0', async () => {
  const kernel = new ClankaKernel('run-seq');
  const e0 = await kernel.log('run.start', 'agent', {});
  const e1 = await kernel.log('step.one', 'agent', {});
  const e2 = await kernel.log('run.end', 'agent', {});
  assert.equal(e0.seq, 0);
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.ok(e1.seq > e0.seq);
  assert.ok(e2.seq > e1.seq);
});

function recalcId(event: Omit<CognitiveEvent, 'id'>): string {
  const { id: _, ...eventWithoutId } = event as Omit<CognitiveEvent, 'id'> & { id?: string };
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}

test('verify: throws on duplicate sequence numbers', async () => {
  const kernel = new ClankaKernel('run-dup-seq');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const history = kernel.getHistory();
  const bad = [...history];
  const invalidDupSeq: Omit<CognitiveEvent, 'id'> = { ...bad[2], seq: 1 };
  bad[2] = { ...invalidDupSeq, id: recalcId(invalidDupSeq) };
  kernel.loadHistory(bad);

  assert.throws(() => kernel.verify());
});

test('verify: rejects forward causal references', async () => {
  const kernel = new ClankaKernel('run-cause-forward');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const history = kernel.getHistory();
  const forwardLinked: Omit<CognitiveEvent, 'id'> = { ...history[1], causes: [history[2].id] };

  const forwardKernel = new ClankaKernel('run-cause-forward-verify');
  forwardKernel.loadHistory([
    history[0],
    { ...forwardLinked, id: recalcId(forwardLinked) },
    history[2],
  ]);
  assert.throws(() => forwardKernel.verify(), /unknown cause/);
});

test('verify: valid sequence passes', async () => {
  const kernel = new ClankaKernel('run-valid');
  await kernel.log('run.start', 'agent', { msg: 'hello' });
  await kernel.log('run.end', 'agent', { msg: 'done' });
  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
});

test('verify: allows multi-cause links to prior events', async () => {
  const kernel = new ClankaKernel('run-multi-cause');
  const start = await kernel.log('run.start', 'agent', { name: 'multi-cause' });
  const thinkA = await kernel.log('agent.think', 'agent', { branch: 'A' }, [start.id]);
  const thinkB = await kernel.log('agent.think', 'agent', { branch: 'B' }, [start.id]);
  await kernel.log('run.commit', 'agent', { status: 'done' }, [thinkA.id, thinkB.id]);

  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 4);
  assert.deepEqual(kernel.getHistory().map(e => e.seq), [0, 1, 2, 3]);
});

test('verify: throws on seq gap (missing middle event)', async () => {
  const kernel = new ClankaKernel('run-gap');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  // Drop the middle event — history becomes [seq0, seq2]
  const history = kernel.getHistory();
  kernel.loadHistory([history[0], history[2]]);

  assert.throws(() => kernel.verify(), /Sequence gap/);
});

test('verify: throws on unknown cause id', async () => {
  const kernel = new ClankaKernel('run-cause');
  // Reference a cause that was never logged
  await kernel.log('run.end', 'agent', {}, ['nonexistent-cause-id']);
  assert.throws(() => kernel.verify(), /unknown cause/);
});

test('verify: valid causal reference passes', async () => {
  const kernel = new ClankaKernel('run-cause-ok');
  const e0 = await kernel.log('run.start', 'agent', {});
  await kernel.log('run.end', 'agent', {}, [e0.id]);
  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
});

test('log: concurrent calls preserve contiguous sequence ordering per kernel', async () => {
  const kernel = new ClankaKernel('run-ordered-concurrent');
  const writes = Array.from({ length: 25 }, (_, i) => kernel.log('agent.think', 'agent', { i }));
  await Promise.all(writes);

  assert.deepEqual(kernel.getHistory().map(e => e.seq), Array.from({ length: 25 }, (_, i) => i));
  assert.equal(kernel.verify().valid, true);
});

// ---------------------------------------------------------------------------
// Replay determinism
// ---------------------------------------------------------------------------

test('replay: identical inputs produce identical event ids', async () => {
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

// ---------------------------------------------------------------------------
// Invalid event payloads
// ---------------------------------------------------------------------------

test('verify: throws when event id is tampered', async () => {
  const kernel = new ClankaKernel('run-tamper');
  await kernel.log('run.start', 'agent', { data: 1 });

  const history = kernel.getHistory();
  history[0] = { ...history[0], id: 'tampered-id-000' };
  kernel.loadHistory(history);

  assert.throws(() => kernel.verify(), /invalid digest/);
});

test('verify: throws when event id is missing (empty string)', async () => {
  const kernel = new ClankaKernel('run-noid');
  await kernel.log('run.start', 'agent', {});

  const history = kernel.getHistory();
  history[0] = { ...history[0], id: '' };
  kernel.loadHistory(history);

  assert.throws(() => kernel.verify(), /invalid digest/);
});

test('verify: throws when payload is altered after logging', async () => {
  const kernel = new ClankaKernel('run-payload');
  await kernel.log('run.start', 'agent', { secret: 'original' });

  const history = kernel.getHistory();
  history[0] = { ...history[0], payload: { secret: 'altered' } };
  kernel.loadHistory(history);

  assert.throws(() => kernel.verify(), /invalid digest/);
});

test('verify: empty history is valid', () => {
  const kernel = new ClankaKernel('run-empty');
  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 0);
});

test('event id is a 64-char hex string (sha256)', async () => {
  const kernel = new ClankaKernel('run-hash');
  const event = await kernel.log('test.event', 'agent', { data: 'value' });
  assert.equal(typeof event.id, 'string');
  assert.equal(event.id.length, 64);
  assert.match(event.id, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// Invalid payload contracts
// ---------------------------------------------------------------------------

function buildValidEvent(overrides: Partial<CognitiveEvent> = {}): CognitiveEvent {
  return {
    v: 1.1,
    id: '000000000000000000000000000000000000000000000000000000000000000000',
    runId: 'run-zod-valid',
    seq: 0,
    type: 'run.started',
    timestamp: 1700000000000,
    causes: [],
    payload: {},
    ...overrides,
  };
}

test('EventSchema: accepts a valid event payload', () => {
  const parsed = EventSchema.safeParse(buildValidEvent());
  assert.equal(parsed.success, true);
});

test('EventSchema: rejects non-object payload', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    payload: 'bad-payload',
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects unknown event type', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    type: 'runtime.unknown',
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects non-array causes', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    causes: 'not-an-array',
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects invalid meta fields', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    meta: { agentId: 123 },
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects missing required fields', () => {
  const parsed = EventSchema.safeParse({
    v: 1.1,
    id: 'invalid',
    runId: 'run-zod-missing',
    seq: 0,
    type: 'run.started',
    timestamp: 1700000000000,
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects wrong field types', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    v: '1.1',
    seq: '0',
    causes: ['ok'],
    payload: { nested: true },
  });
  assert.equal(parsed.success, false);
});

// ---------------------------------------------------------------------------
// Concurrent run isolation
// ---------------------------------------------------------------------------

test('concurrent log calls remain isolated per kernel', async () => {
  const alpha = new ClankaKernel('run-alpha');
  const beta = new ClankaKernel('run-beta');
  const alphaSteps = Array.from({ length: 20 }, (_, i) => alpha.log('agent.think', 'agent-a', { i }));
  const betaSteps = Array.from({ length: 20 }, (_, i) => beta.log('agent.think', 'agent-b', { i }));
  await Promise.all([Promise.all(alphaSteps), Promise.all(betaSteps)]);

  const historyA = alpha.getHistory();
  const historyB = beta.getHistory();

  assert.equal(historyA.length, 20);
  assert.equal(historyB.length, 20);
  assert.deepEqual(
    historyA.map(e => e.runId),
    Array.from({ length: 20 }, () => 'run-alpha')
  );
  assert.deepEqual(
    historyB.map(e => e.runId),
    Array.from({ length: 20 }, () => 'run-beta')
  );
  assert.deepEqual(
    historyA.map(e => e.seq),
    Array.from({ length: 20 }, (_, i) => i)
  );
  assert.deepEqual(
    historyB.map(e => e.seq),
    Array.from({ length: 20 }, (_, i) => i)
  );
});

test('interleaved concurrent logging does not mix histories', async () => {
  const alpha = new ClankaKernel('run-alpha-mix');
  const beta = new ClankaKernel('run-beta-mix');
  const alphaWrites = Array.from({ length: 12 }, (_, i) =>
    Promise.resolve().then(() => alpha.log('agent.think', 'agent-a', { i }))
  );
  const betaWrites = Array.from({ length: 12 }, (_, i) =>
    Promise.resolve().then(() => beta.log('agent.think', 'agent-b', { i }))
  );

  await Promise.all([...alphaWrites, ...betaWrites]);

  const historyA = alpha.getHistory();
  const historyB = beta.getHistory();

  assert.deepEqual(historyA.map(e => e.runId), Array.from({ length: 12 }, () => 'run-alpha-mix'));
  assert.deepEqual(historyB.map(e => e.runId), Array.from({ length: 12 }, () => 'run-beta-mix'));
  assert.deepEqual(historyA.map(e => e.seq), Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(historyB.map(e => e.seq), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(new Set(historyA.map(e => e.id)).size, historyA.length);
  assert.equal(new Set(historyB.map(e => e.id)).size, historyB.length);
});

test('concurrent run logging does not leak event ids across histories', async () => {
  const alpha = new ClankaKernel('run-alpha-isolated');
  const beta = new ClankaKernel('run-beta-isolated');

  const alphaEvents = [];
  const betaEvents = [];

  for (let i = 0; i < 10; i++) {
    alphaEvents.push(alpha.log('model.requested', 'agent-a', { requestId: `a-${i}` }));
    betaEvents.push(beta.log('model.requested', 'agent-b', { requestId: `b-${i}` }));
  }

  await Promise.all([...alphaEvents, ...betaEvents]);

  const historyA = alpha.getHistory();
  const historyB = beta.getHistory();
  const idsA = new Set(historyA.map(e => e.id));
  const idsB = new Set(historyB.map(e => e.id));

  assert.equal(idsA.size, historyA.length);
  assert.equal(idsB.size, historyB.length);
  for (const id of idsA) {
    assert.ok(!idsB.has(id));
  }
});
