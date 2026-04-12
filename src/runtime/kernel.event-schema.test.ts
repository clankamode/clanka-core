import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CognitiveEvent } from './kernel';
import { EventSchema } from '../../packages/core/event';

function buildValidEvent(overrides: Partial<CognitiveEvent> = {}): CognitiveEvent {
  return {
    v: 1.1,
    id: '000000000000000000000000000000000000000000000000000000000000000000',
    runId: 'run-zod-valid',
    seq: 0,
    type: 'run.started',
    timestamp: 1700000000000,
    causes: [],
    payload: {},
    ...overrides,
  };
}

test('EventSchema: accepts a valid event payload', () => {
  const parsed = EventSchema.safeParse(buildValidEvent());
  assert.equal(parsed.success, true);
});

test('EventSchema: rejects non-object payload', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    payload: 'bad-payload',
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects unknown event type', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    type: 'runtime.unknown',
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects non-array causes', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    causes: 'not-an-array',
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects invalid meta fields', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    meta: { agentId: 123 },
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects missing required fields', () => {
  const parsed = EventSchema.safeParse({
    v: 1.1,
    id: 'invalid',
    runId: 'run-zod-missing',
    seq: 0,
    type: 'run.started',
    timestamp: 1700000000000,
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects wrong field types', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    v: '1.1',
    seq: '0',
    causes: ['ok'],
    payload: { nested: true },
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects non-string cause IDs', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    causes: ['valid-cause', 123],
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects malformed meta.tool/meta.model values', () => {
  const parsed = EventSchema.safeParse({
    ...buildValidEvent(),
    meta: { agentId: 'agent-1', tool: 999, model: false },
  });
  assert.equal(parsed.success, false);
});

test('EventSchema: rejects missing payload field', () => {
  const { payload: _payload, ...withoutPayload } = buildValidEvent();
  const parsed = EventSchema.safeParse(withoutPayload);
  assert.equal(parsed.success, false);
});

test('EventSchema: accepts optional meta.tool/model with causes omitted', () => {
  const { causes: _causes, ...withoutCauses } = buildValidEvent();
  const parsed = EventSchema.safeParse({
    ...withoutCauses,
    meta: { agentId: 'agent-1', tool: 'bash', model: 'gpt-5' },
  });
  assert.equal(parsed.success, true);
});
