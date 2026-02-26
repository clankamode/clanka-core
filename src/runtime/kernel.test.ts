import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCanonical, ClankaKernel } from './kernel';
import type { CognitiveEvent } from './kernel';

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

test('verify: valid sequence passes', async () => {
  const kernel = new ClankaKernel('run-valid');
  await kernel.log('run.start', 'agent', { msg: 'hello' });
  await kernel.log('run.end', 'agent', { msg: 'done' });
  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
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
