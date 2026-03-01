import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { EventStore } from './event-store';
import { SchemaRegistry, type EventEnvelope } from './schema-registry';

function buildStore(): EventStore {
  const registry = new SchemaRegistry();
  registry.register('run.started', z.object({ name: z.string() }));
  registry.register(
    'tool.requested',
    z.object({
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
  );
  return new EventStore(registry);
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    v: 1.1,
    id: 'evt-1',
    runId: 'run-event-store',
    seq: 0,
    type: 'run.started',
    timestamp: 1_700_000_000_000,
    causes: [],
    payload: { name: 'default' },
    ...overrides,
  };
}

describe('EventStore', () => {
  test('append stores a valid event and returns the parsed event', () => {
    const store = buildStore();
    const event = makeEvent({ payload: { name: 'alpha' } });

    const appended = store.append(event);
    const all = store.query();

    assert.equal(appended.id, 'evt-1');
    assert.deepEqual(appended.payload, { name: 'alpha' });
    assert.equal(all.length, 1);
    assert.deepEqual(all[0].payload, { name: 'alpha' });
  });

  test('append rejects invalid payloads and keeps store unchanged', () => {
    const store = buildStore();
    const invalid = makeEvent({
      payload: { name: 123 } as unknown as Record<string, unknown>,
    });

    assert.throws(
      () => store.append(invalid),
      /Invalid payload for event type "run.started"/,
    );
    assert.equal(store.query().length, 0);
  });

  test('append rejects events whose type is not registered', () => {
    const store = buildStore();
    const invalid = makeEvent({ type: 'tool.responded', payload: { output: 'ok' } });

    assert.throws(
      () => store.append(invalid),
      /No schema registered for event type "tool.responded"/,
    );
    assert.equal(store.query().length, 0);
  });

  test('append rejects malformed event envelopes', () => {
    const store = buildStore();
    const event = makeEvent();
    const { id: _id, ...withoutId } = event;

    assert.throws(
      () => store.append(withoutId),
      /Invalid event/,
    );
    assert.equal(store.query().length, 0);
  });

  test('append clones stored data so external mutation does not alter history', () => {
    const store = buildStore();
    const event = makeEvent({ payload: { name: 'immutable' } });

    store.append(event);
    (event.payload as { name: string }).name = 'mutated';

    const restored = store.query();
    assert.deepEqual(restored[0].payload, { name: 'immutable' });
  });

  test('query with no filters returns events in append order', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', seq: 0, timestamp: 100, payload: { name: 'a' } }));
    store.append(makeEvent({ id: 'evt-2', seq: 1, timestamp: 200, payload: { name: 'b' } }));
    store.append(makeEvent({ id: 'evt-3', seq: 2, timestamp: 300, payload: { name: 'c' } }));

    const result = store.query();
    assert.deepEqual(result.map(event => event.id), ['evt-1', 'evt-2', 'evt-3']);
  });

  test('query can filter by type', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', type: 'run.started', payload: { name: 'start' } }));
    store.append(makeEvent({
      id: 'evt-2',
      seq: 1,
      type: 'tool.requested',
      payload: { tool: 'ls', args: { path: '.' } },
    }));
    store.append(makeEvent({ id: 'evt-3', seq: 2, type: 'run.started', payload: { name: 'end' } }));

    const result = store.query({ type: 'run.started' });
    assert.deepEqual(result.map(event => event.id), ['evt-1', 'evt-3']);
  });

  test('query can filter by since timestamp inclusively', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', timestamp: 100, payload: { name: 'a' } }));
    store.append(makeEvent({ id: 'evt-2', seq: 1, timestamp: 200, payload: { name: 'b' } }));
    store.append(makeEvent({ id: 'evt-3', seq: 2, timestamp: 300, payload: { name: 'c' } }));

    const result = store.query({ since: 200 });
    assert.deepEqual(result.map(event => event.id), ['evt-2', 'evt-3']);
  });

  test('query with since beyond all timestamps returns empty list', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', timestamp: 100, payload: { name: 'a' } }));
    store.append(makeEvent({ id: 'evt-2', seq: 1, timestamp: 200, payload: { name: 'b' } }));

    const result = store.query({ since: 500 });
    assert.deepEqual(result, []);
  });

  test('query supports combining since and type filters', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', timestamp: 100, payload: { name: 'a' } }));
    store.append(makeEvent({
      id: 'evt-2',
      seq: 1,
      timestamp: 200,
      type: 'tool.requested',
      payload: { tool: 'ls', args: { path: '.' } },
    }));
    store.append(makeEvent({
      id: 'evt-3',
      seq: 2,
      timestamp: 300,
      type: 'tool.requested',
      payload: { tool: 'pwd', args: {} },
    }));

    const result = store.query({ since: 250, type: 'tool.requested' });
    assert.deepEqual(result.map(event => event.id), ['evt-3']);
  });

  test('query limit truncates results after filtering', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', timestamp: 100, payload: { name: 'a' } }));
    store.append(makeEvent({ id: 'evt-2', seq: 1, timestamp: 200, payload: { name: 'b' } }));
    store.append(makeEvent({ id: 'evt-3', seq: 2, timestamp: 300, payload: { name: 'c' } }));

    const result = store.query({ since: 100, limit: 2 });
    assert.deepEqual(result.map(event => event.id), ['evt-1', 'evt-2']);
  });

  test('query supports limit = 0', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', payload: { name: 'a' } }));

    const result = store.query({ limit: 0 });
    assert.deepEqual(result, []);
  });

  test('query rejects negative limit values', () => {
    const store = buildStore();

    assert.throws(
      () => store.query({ limit: -1 }),
      /Too small/,
    );
  });

  test('query rejects empty type filter values', () => {
    const store = buildStore();

    assert.throws(
      () => store.query({ type: '' }),
      /Too small/,
    );
  });

  test('query rejects unknown filter fields', () => {
    const store = buildStore();

    assert.throws(
      () => store.query({ extra: true } as unknown as { since?: number; type?: string; limit?: number }),
      /Unrecognized key/,
    );
  });

  test('clear removes all stored events', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1' }));
    store.append(makeEvent({ id: 'evt-2', seq: 1 }));

    store.clear();

    assert.deepEqual(store.query(), []);
  });

  test('clear is idempotent when the store is already empty', () => {
    const store = buildStore();

    store.clear();
    store.clear();

    assert.deepEqual(store.query(), []);
  });

  test('query returns cloned events so result mutation does not affect store', () => {
    const store = buildStore();
    store.append(makeEvent({ id: 'evt-1', payload: { name: 'stable' } }));

    const firstQuery = store.query();
    (firstQuery[0].payload as { name: string }).name = 'changed';

    const secondQuery = store.query();
    assert.deepEqual(secondQuery[0].payload, { name: 'stable' });
  });
});
