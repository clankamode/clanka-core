import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  EventSchema,
  EventTypeSchema,
  canonicalJSON,
  contentDigest,
  createEvent,
} from './event';

describe('EventTypeSchema / createEvent', () => {
  test('EventTypeSchema matches CONTRACT EventLog coverage checklist', () => {
    const expected = [
      'run.started',
      'run.finished',
      'run.commit',
      'agent.started',
      'agent.finished',
      'model.requested',
      'model.responded',
      'tool.requested',
      'tool.responded',
      'fs.snapshot',
      'fs.diff',
      'decision.made',
      'invariant.failed',
      'budget.exhausted',
    ];

    assert.deepEqual([...EventTypeSchema.options], expected);

    for (const type of expected) {
      assert.equal(EventTypeSchema.safeParse(type).success, true);
    }
  });

  test('EventTypeSchema rejects CLI run.start (distinct from EventLog run.started)', () => {
    assert.equal(EventTypeSchema.safeParse('run.start').success, false);
    assert.equal(EventTypeSchema.safeParse('totally.fake').success, false);
    assert.equal(EventTypeSchema.safeParse('error.raised').success, false);
  });

  test('EventSchema rejects CLI run.start and unknown types at runtime', () => {
    assert.equal(
      EventSchema.safeParse({
        v: 1.1,
        id: 'x',
        runId: 'r',
        seq: 0,
        type: 'run.start',
        timestamp: 1,
        payload: {},
      }).success,
      false,
    );
    assert.equal(
      EventSchema.safeParse({
        v: 1.1,
        id: 'x',
        runId: 'r',
        seq: 0,
        type: 'totally.fake',
        timestamp: 1,
        payload: {},
      }).success,
      false,
    );
  });

  test('createEvent rejects unknown event types at runtime', () => {
    assert.throws(
      () => createEvent(1.1, 'totally.fake' as never, 'run-1', 0, {}),
      /Invalid/,
    );
    assert.throws(
      () => createEvent(1.1, 'run.start' as never, 'run-1', 0, {}),
      /Invalid/,
    );
  });

  test('createEvent accepts a contracted EventLog type', () => {
    const event = createEvent(1.1, 'run.commit', 'run-1', 0, { commitHash: 'abc' });
    assert.equal(event.type, 'run.commit');
    assert.equal(EventSchema.safeParse(event).success, true);
  });
});

describe('canonicalJSON', () => {
  test('recursively sorts nested object keys (not shallow top-level only)', () => {
    const a = { b: 1, a: { y: 1, x: 2 } };
    const b = { a: { x: 2, y: 1 }, b: 1 };

    assert.equal(canonicalJSON(a), '{"a":{"x":2,"y":1},"b":1}');
    assert.equal(canonicalJSON(a), canonicalJSON(b));
  });

  test('preserves array element order while canonicalizing nested objects', () => {
    assert.equal(
      canonicalJSON([null, 1, 'two', { b: 2, a: 1 }]),
      '[null,1,"two",{"a":1,"b":2}]',
    );
  });

  test('omits undefined object values', () => {
    assert.equal(canonicalJSON({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
  });

  test('contentDigest is stable across nested key insertion order', () => {
    const left = { payload: { z: 1, nested: { b: 2, a: 1 } }, type: 'run.started' };
    const right = { type: 'run.started', payload: { nested: { a: 1, b: 2 }, z: 1 } };
    assert.equal(contentDigest(left), contentDigest(right));
  });
});
