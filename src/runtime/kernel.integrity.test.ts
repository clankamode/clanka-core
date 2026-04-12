import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClankaKernel } from './kernel';

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
