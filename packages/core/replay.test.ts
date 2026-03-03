import { describe, test } from 'vitest';
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

describe('normalizeEvents determinism', () => {
  test('sorts by timestamp, then type', async () => {
    const events = [
      makeEvent({ id: 'e4', seq: 3, timestamp: 200, type: 'tool.responded' }),
      makeEvent({ id: 'e2', seq: 1, timestamp: 100, type: 'run.started' }),
      makeEvent({ id: 'e1', seq: 0, timestamp: 100, type: 'agent.started' }),
      makeEvent({ id: 'e3', seq: 2, timestamp: 100, type: 'tool.requested' }),
    ];

    const harness = new ReplayHarness({
      events,
      tools: {},
      models: {},
      invariants: [],
    });

    const result = await harness.replay();

    assert.deepEqual(
      result.events.map(event => `${event.timestamp}:${event.type}`),
      [
        '100:agent.started',
        '100:run.started',
        '100:tool.requested',
        '200:tool.responded',
      ],
    );
  });
});

describe('concurrent run isolation', () => {
  test('two harnesses replay concurrently without shared state', async () => {
    const runAEvents = [
      makeEvent({ id: 'a1', runId: 'run-A', seq: 0, timestamp: 10, type: 'run.started', payload: { run: 'A' } }),
      makeEvent({ id: 'a2', runId: 'run-A', seq: 1, timestamp: 20, type: 'run.finished', payload: { run: 'A' } }),
    ];
    const runBEvents = [
      makeEvent({ id: 'b1', runId: 'run-B', seq: 0, timestamp: 10, type: 'run.started', payload: { run: 'B' } }),
      makeEvent({ id: 'b2', runId: 'run-B', seq: 1, timestamp: 20, type: 'run.finished', payload: { run: 'B' } }),
    ];

    const harnessA = new ReplayHarness({
      events: runAEvents,
      tools: {},
      models: {},
      invariants: [],
    });
    const harnessB = new ReplayHarness({
      events: runBEvents,
      tools: {},
      models: {},
      invariants: [],
    });

    const [resultA, resultB] = await Promise.all([harnessA.replay(), harnessB.replay()]);

    assert.deepEqual(resultA.events.map(event => event.runId), ['run-A', 'run-A']);
    assert.deepEqual(resultB.events.map(event => event.runId), ['run-B', 'run-B']);

    resultA.events[0].payload = { run: 'A-mutated' };
    const rerunB = await harnessB.replay();
    assert.deepEqual(rerunB.events.map(event => event.payload), [{ run: 'B' }, { run: 'B' }]);
  });
});
