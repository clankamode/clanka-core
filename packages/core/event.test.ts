import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  EventSchema,
  EventTypeSchema,
  createEvent,
} from './event';

describe('EventTypeSchema / createEvent', () => {
  test('EventTypeSchema accepts every CONTRACT EventLog type', () => {
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

  test('EventTypeSchema rejects unknown event types', () => {
    assert.equal(EventTypeSchema.safeParse('totally.fake').success, false);
    assert.equal(EventTypeSchema.safeParse('error.raised').success, false);
    assert.equal(EventTypeSchema.safeParse('run.start').success, false);
  });

  test('EventSchema rejects unknown event types at runtime', () => {
    const parsed = EventSchema.safeParse({
      v: 1.1,
      id: 'x',
      runId: 'r',
      seq: 0,
      type: 'totally.fake',
      timestamp: 1,
      payload: {},
    });
    assert.equal(parsed.success, false);
  });

  test('createEvent rejects unknown event types at runtime', () => {
    assert.throws(
      () => createEvent(1.1, 'totally.fake' as never, 'run-1', 0, {}),
      /Invalid/,
    );
  });

  test('createEvent accepts a contracted EventLog type', () => {
    const event = createEvent(1.1, 'run.commit', 'run-1', 0, { commitHash: 'abc' });
    assert.equal(event.type, 'run.commit');
    assert.equal(EventSchema.safeParse(event).success, true);
  });
});
