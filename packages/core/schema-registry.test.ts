import { describe, test } from 'vitest';
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
      /Invalid/,
    );
  });

  test('register rejects event types outside the CONTRACT registry set', () => {
    const registry = new SchemaRegistry();

    assert.throws(
      () => registry.register('totally.fake', z.object({})),
      /Invalid/,
    );
    assert.throws(
      () => registry.register('run.start', z.object({})),
      /Invalid/,
    );
  });

  test('validate rejects unknown event types instead of storing them', () => {
    const registry = new SchemaRegistry();
    registry.register('run.started', z.object({ name: z.string() }));

    assert.throws(
      () => registry.validate(makeEvent({ type: 'totally.fake', payload: {} })),
      /Invalid event/,
    );
  });

  test('forEventLog registers every EventLog type with open payloads', () => {
    const registry = SchemaRegistry.forEventLog();

    assert.deepEqual(registry.listTypes(), [
      'agent.finished',
      'agent.started',
      'budget.exhausted',
      'decision.made',
      'fs.diff',
      'fs.snapshot',
      'invariant.failed',
      'model.requested',
      'model.responded',
      'run.commit',
      'run.finished',
      'run.started',
      'tool.requested',
      'tool.responded',
    ]);

    const parsed = registry.validate(
      makeEvent({ type: 'budget.exhausted', payload: { budget: 'tokens', remaining: 0 } }),
    );
    assert.equal(parsed.type, 'budget.exhausted');
  });

  test('forEventLog does not accept error.raised without explicit registration', () => {
    const registry = SchemaRegistry.forEventLog();

    assert.throws(
      () => registry.validate(makeEvent({
        type: 'error.raised',
        payload: { code: 'E', message: 'x' },
      })),
      /No schema registered for event type "error.raised"/,
    );

    registry.register('error.raised', z.object({ code: z.string(), message: z.string() }));
    const parsed = registry.validate(makeEvent({
      type: 'error.raised',
      payload: { code: 'E', message: 'x' },
    }));
    assert.equal(parsed.type, 'error.raised');
  });

  test('forStrictContract enforces CONTRACT required payload fields', () => {
    const registry = SchemaRegistry.forStrictContract();

    assert.throws(
      () => registry.validate(makeEvent({ type: 'run.started', payload: { name: 'only-name' } })),
      /Invalid payload for event type "run.started"/,
    );

    const parsed = registry.validate(makeEvent({
      type: 'run.started',
      payload: { name: 'clanka-core', version: '1.0.0' },
    }));
    assert.deepEqual(parsed.payload, { name: 'clanka-core', version: '1.0.0' });

    const errorEvent = registry.validate(makeEvent({
      type: 'error.raised',
      payload: { code: 'E_TOOL', message: 'Tool execution failed' },
    }));
    assert.equal(errorEvent.type, 'error.raised');
  });

  test('forStrictContract rejects EventLog-only types that lack a strict schema', () => {
    const registry = SchemaRegistry.forStrictContract();

    assert.throws(
      () => registry.validate(makeEvent({ type: 'run.commit', payload: { commitHash: 'abc' } })),
      /No schema registered for event type "run.commit"/,
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
