import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { SchemaRegistry, type EventEnvelope } from './schema-registry';

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    v: 1.1,
    id: 'evt-1',
    runId: 'run-schema-registry',
    seq: 0,
    type: 'run.started',
    timestamp: 1_700_000_000_000,
    causes: [],
    payload: { name: 'schema-test' },
    ...overrides,
  };
}

describe('SchemaRegistry', () => {
  test('listTypes returns an empty list before registration', () => {
    const registry = new SchemaRegistry();
    assert.deepEqual(registry.listTypes(), []);
  });

  test('register stores schemas and listTypes returns sorted types', () => {
    const registry = new SchemaRegistry();
    registry.register('tool.requested', z.object({ tool: z.string() }));
    registry.register('run.started', z.object({ name: z.string() }));

    assert.deepEqual(registry.listTypes(), ['run.started', 'tool.requested']);
  });

  test('validate accepts a valid event with matching payload schema', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    const event = makeEvent({ type: 'run.started', payload: { name: 'ok' } });
    const parsed = registry.validate(event);

    assert.equal(parsed.type, 'run.started');
    assert.deepEqual(parsed.payload, { name: 'ok' });
  });

  test('validate rejects non-object events', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    assert.throws(
      () => registry.validate('not-an-event'),
      /Invalid event/,
    );
  });

  test('validate rejects events missing required envelope fields', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    const event = makeEvent();
    const { id: _id, ...withoutId } = event;

    assert.throws(
      () => registry.validate(withoutId),
      /Invalid event/,
    );
  });

  test('validate rejects unregistered event types', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    const event = makeEvent({ type: 'tool.responded', payload: { output: 'ok' } });

    assert.throws(
      () => registry.validate(event),
      /No schema registered for event type "tool.responded"/,
    );
  });

  test('validate rejects payloads that fail the registered schema', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    const event = makeEvent({
      type: 'run.started',
      payload: { name: 42 } as unknown as Record<string, unknown>,
    });

    assert.throws(
      () => registry.validate(event),
      /Invalid payload for event type "run.started"/,
    );
  });

  test('validate accepts events with optional causes and meta omitted', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    const event = makeEvent();
    const { causes: _causes, meta: _meta, ...withoutOptionals } = event;

    const parsed = registry.validate(withoutOptionals);

    assert.equal(parsed.type, 'run.started');
    assert.deepEqual(parsed.payload, { name: 'schema-test' });
    assert.equal(parsed.causes, undefined);
    assert.equal(parsed.meta, undefined);
  });

  test('register replaces schemas for an existing type', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));
    registry.register('run.started', z.object({ name: z.string(), version: z.number() }));

    assert.throws(
      () => registry.validate(makeEvent({ payload: { name: 'missing-version' } })),
      /Invalid payload for event type "run.started"/,
    );

    const parsed = registry.validate(makeEvent({ payload: { name: 'ok', version: 1 } }));
    assert.deepEqual(parsed.payload, { name: 'ok', version: 1 });
  });

  test('register rejects empty event type names', () => {
    const registry = new SchemaRegistry();

    assert.throws(
      () => registry.register('', z.object({})),
      /Event type must be a non-empty string/,
    );
  });

  test('validate supports payload schemas with transforms that return objects', () => {
    const registry = new SchemaRegistry();
    registry.register(
      'tool.requested',
      z.object({ tool: z.string() }).transform(payload => ({
        ...payload,
        normalized: true,
      })),
    );

    const parsed = registry.validate(
      makeEvent({ type: 'tool.requested', payload: { tool: 'bash' } }),
    );

    assert.deepEqual(parsed.payload, { tool: 'bash', normalized: true });
  });

  test('validate rejects transformed payloads that are not objects', () => {
    const registry = new SchemaRegistry();
    registry.register(
      'tool.requested',
      z.object({ tool: z.string() }).transform(() => 'invalid-output'),
    );

    assert.throws(
      () => registry.validate(makeEvent({ type: 'tool.requested', payload: { tool: 'bash' } })),
      /payload must be an object/,
    );
  });

  test('validate rejects events with non-string type values', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    const event = makeEvent({ type: 123 as unknown as string });

    assert.throws(
      () => registry.validate(event),
      /Invalid event/,
    );
  });
});
