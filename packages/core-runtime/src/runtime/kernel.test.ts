import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import {
  ClankaKernel,
  EVENT_SCHEMA_VERSION,
  toCanonical,
  type CognitiveEvent,
} from './kernel.js';

function digestFor(eventWithoutId: Omit<CognitiveEvent, 'id'>): string {
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}

function makeEvent(
  sessionId: string,
  overrides: Partial<CognitiveEvent> & Pick<CognitiveEvent, 'seq' | 'type'>,
): CognitiveEvent {
  const { id: _omitId, ...rest } = overrides;
  const eventWithoutId: Omit<CognitiveEvent, 'id'> = {
    v: EVENT_SCHEMA_VERSION,
    runId: sessionId,
    timestamp: 1_700_000_000_000 + overrides.seq,
    causes: [],
    payload: {},
    meta: { agentId: 'test' },
    ...rest,
    seq: overrides.seq,
    type: overrides.type,
  };
  return { ...eventWithoutId, id: digestFor(eventWithoutId) };
}

test('verify accepts a well-formed single-event history', async () => {
  const kernel = new ClankaKernel('run-ok');
  await kernel.log('run.start', 'agent', {});
  assert.deepEqual(kernel.verify(), { valid: true, eventCount: 1 });
  assert.equal(kernel.getHistory()[0]?.v, EVENT_SCHEMA_VERSION);
});

test('verify rejects runId that does not match the kernel session', () => {
  const kernel = new ClankaKernel('run-session');
  const foreign = makeEvent('run-other', { seq: 0, type: 'run.start' });
  kernel.loadHistory([foreign]);
  assert.throws(() => kernel.verify(), /runId/);
});

test('verify rejects unsupported schema version v', () => {
  const kernel = new ClankaKernel('run-v');
  const bad = makeEvent('run-v', { seq: 0, type: 'run.start', v: 1 });
  kernel.loadHistory([bad]);
  assert.throws(() => kernel.verify(), /version/i);
});

test('verify rejects non-finite timestamps', () => {
  const kernel = new ClankaKernel('run-ts');
  const bad = makeEvent('run-ts', {
    seq: 0,
    type: 'run.start',
    timestamp: Number.NaN,
  });
  kernel.loadHistory([bad]);
  assert.throws(() => kernel.verify(), /timestamp/i);
});

test('verify rejects decreasing timestamps', () => {
  const kernel = new ClankaKernel('run-ts-order');
  const first = makeEvent('run-ts-order', { seq: 0, type: 'run.start', timestamp: 200 });
  const second = makeEvent('run-ts-order', {
    seq: 1,
    type: 'run.end',
    timestamp: 100,
    causes: [first.id],
  });
  kernel.loadHistory([first, second]);
  assert.throws(() => kernel.verify(), /decreasing timestamp/i);
});

test('enforceInvariants records invariant.failed without re-entering log', async () => {
  const kernel = new ClankaKernel('run-invariant-reentry');
  let checks = 0;
  kernel.registerInvariant({
    name: 'always_fail',
    description: 'fails on every history snapshot',
    async check() {
      checks += 1;
      assert.ok(checks <= 1, `enforceInvariants re-entered via invariant.failed (checks=${checks})`);
      return { valid: false, message: 'nope', severity: 'error' };
    },
  });

  await kernel.log('run.start', 'agent', {});
  const history = kernel.getHistory();

  assert.equal(checks, 1);
  assert.equal(history.length, 2);
  assert.equal(history[1]?.type, 'invariant.failed');
  assert.equal(history[1]?.payload.invariant, 'always_fail');
  assert.deepEqual(history[1]?.causes, [history[0]?.id]);
  assert.deepEqual(kernel.verify(), { valid: true, eventCount: 2 });
});

test('selective invariant pins failure cause to ctx.event trigger', async () => {
  const kernel = new ClankaKernel('run-invariant-selective');
  kernel.registerInvariant({
    name: 'tool_requires_plan',
    description: 'tool.requested must be justified by a decision',
    async check(ctx: { event: CognitiveEvent }) {
      if (ctx.event.type === 'tool.requested') {
        return { valid: false, message: 'missing decision cause', severity: 'error' };
      }
      return { valid: true };
    },
  });

  const trigger = await kernel.log('tool.requested', 'agent', { tool: 'bash' });
  const history = kernel.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[1]?.type, 'invariant.failed');
  assert.deepEqual(history[1]?.causes, [trigger.id]);
  assert.equal(kernel.verify().valid, true);
});

test('async invariant checks keep invariant.failed cause on the trigger', async () => {
  const kernel = new ClankaKernel('run-invariant-race');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  kernel.registerInvariant({
    name: 'slow_fail_on_bad',
    description: 'fails on bad.event after an await gap',
    async check(ctx: { event: CognitiveEvent }) {
      if (ctx.event.type === 'bad.event') {
        await gate;
        return { valid: false, message: 'bad event', severity: 'error' };
      }
      return { valid: true };
    },
  });

  const badPromise = kernel.log('bad.event', 'agent', { n: 1 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const okPromise = kernel.log('ok.event', 'agent', { n: 2 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  release();

  const [badEvent] = await Promise.all([badPromise, okPromise]);
  const history = kernel.getHistory();
  const failure = history.find((event) => event.type === 'invariant.failed');

  assert.ok(failure, 'expected invariant.failed event');
  assert.deepEqual(failure.causes, [badEvent.id]);
  assert.equal(kernel.verify().valid, true);
});
