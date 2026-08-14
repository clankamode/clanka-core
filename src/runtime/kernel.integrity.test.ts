import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClankaKernel } from './kernel';
import { recalcKernelEventId } from './kernel-test-helpers';

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

test('verify: throws when event runId does not match kernel session', async () => {
  const kernel = new ClankaKernel('expected-run');
  await kernel.log('run.start', 'agent', { data: 1 });

  const [event] = kernel.getHistory();
  const mismatched = { ...event, runId: 'other-run' };
  kernel.loadHistory([
    { ...mismatched, id: recalcKernelEventId(mismatched as Record<string, unknown>) },
  ]);

  assert.throws(() => kernel.verify(), /runId/);
});

test('verify: throws when fromJSONL runId disagrees with event runId', async () => {
  const producer = new ClankaKernel('run-B');
  await producer.log('run.start', 'agent', { leaked: true });

  const loadedAsA = ClankaKernel.fromJSONL('run-A', producer.serialize());
  assert.throws(() => loadedAsA.verify(), /runId/);
});

test('verify: throws when history mixes multiple runIds', async () => {
  const kernel = new ClankaKernel('run-mix');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const history = kernel.getHistory();
  const foreign = {
    ...history[0],
    runId: 'foreign-run',
    seq: 0,
    payload: { foreign: true },
  };
  const linked = {
    ...history[1],
    seq: 1,
    causes: [recalcKernelEventId(foreign as Record<string, unknown>)],
    runId: 'run-mix',
  };
  const foreignEvent = {
    ...foreign,
    id: recalcKernelEventId(foreign as Record<string, unknown>),
  };
  const linkedEvent = {
    ...linked,
    causes: [foreignEvent.id],
    id: recalcKernelEventId({ ...linked, causes: [foreignEvent.id] } as Record<string, unknown>),
  };

  kernel.loadHistory([foreignEvent, linkedEvent]);
  assert.throws(() => kernel.verify(), /runId/);
});

test('verify: throws when event schema version is not 1.1', async () => {
  const kernel = new ClankaKernel('run-version');
  await kernel.log('run.start', 'agent', {});

  const [event] = kernel.getHistory();
  const wrongVersion = { ...event, v: 2 };
  kernel.loadHistory([
    { ...wrongVersion, id: recalcKernelEventId(wrongVersion as Record<string, unknown>) },
  ]);

  assert.throws(() => kernel.verify(), /version|v\b/i);
});

test('verify: throws when timestamp is not a finite number', async () => {
  const kernel = new ClankaKernel('run-nan-ts');
  await kernel.log('run.start', 'agent', {});

  const [event] = kernel.getHistory();
  const nanTs = { ...event, timestamp: Number.NaN };
  kernel.loadHistory([
    { ...nanTs, id: recalcKernelEventId(nanTs as Record<string, unknown>) },
  ]);

  assert.throws(() => kernel.verify(), /timestamp/i);
});

test('verify: throws when timestamps decrease', async () => {
  const kernel = new ClankaKernel('run-ts-order');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const history = kernel.getHistory();
  const earlier = { ...history[1], timestamp: history[0].timestamp - 1 };
  kernel.loadHistory([
    history[0],
    { ...earlier, id: recalcKernelEventId(earlier as Record<string, unknown>) },
  ]);

  assert.throws(() => kernel.verify(), /timestamp/i);
});
