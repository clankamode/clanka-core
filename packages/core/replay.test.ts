import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplayHarness } from './replay';
import type { Event } from './event';

function makeEvent({
  id,
  seq,
  timestamp,
  ...overrides
}: Partial<Event> & { id: string; seq: number; timestamp: number }): Event {
  return {
    v: 1.1,
    id,
    runId: 'run-replay-test',
    seq,
    type: 'run.started',
    timestamp,
    causes: [],
    payload: {},
    ...overrides,
  };
}

test('replay with zero events returns empty result', async () => {
  const harness = new ReplayHarness({
    events: [],
    tools: {},
    models: {},
    invariants: [],
  });

  const result = await harness.replay();

  assert.deepEqual(result.events, []);
  assert.equal(result.invariantResults.length, 0);
  assert.equal(result.success, true);
});

test('replay with duplicate event IDs applies last-write-wins', async () => {
  const first = makeEvent({
    id: 'dup-id',
    seq: 0,
    timestamp: 100,
    payload: { version: 'first' },
  });
  const second = makeEvent({
    id: 'dup-id',
    seq: 1,
    timestamp: 200,
    payload: { version: 'second' },
  });

  const harness = new ReplayHarness({
    events: [first, second],
    tools: {},
    models: {},
    invariants: [],
  });

  const result = await harness.replay();

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, 'dup-id');
  assert.deepEqual(result.events[0].payload, { version: 'second' });
});

test('replay with out-of-order timestamps returns events sorted by timestamp', async () => {
  const events = [
    makeEvent({ id: 'e3', seq: 2, timestamp: 300, type: 'run.finished' }),
    makeEvent({ id: 'e1', seq: 0, timestamp: 100, type: 'run.started' }),
    makeEvent({ id: 'e2', seq: 1, timestamp: 200, type: 'decision.made' }),
  ];

  const harness = new ReplayHarness({
    events,
    tools: {},
    models: {},
    invariants: [],
  });

  const result = await harness.replay();

  assert.deepEqual(result.events.map(event => event.timestamp), [100, 200, 300]);
  assert.deepEqual(result.events.map(event => event.id), ['e1', 'e2', 'e3']);
});
