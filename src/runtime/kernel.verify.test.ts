import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClankaKernel } from './kernel';
import type { CognitiveEvent } from './kernel';
import { recalcKernelEventId } from './kernel-test-helpers';

test('log: seq numbers are strictly increasing from 0', async () => {
  const kernel = new ClankaKernel('run-seq');
  const e0 = await kernel.log('run.start', 'agent', {});
  const e1 = await kernel.log('step.one', 'agent', {});
  const e2 = await kernel.log('run.end', 'agent', {});
  assert.equal(e0.seq, 0);
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.ok(e1.seq > e0.seq);
  assert.ok(e2.seq > e1.seq);
});

test('verify: throws on duplicate sequence numbers', async () => {
  const kernel = new ClankaKernel('run-dup-seq');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const history = kernel.getHistory();
  const bad = [...history];
  const invalidDupSeq: Omit<CognitiveEvent, 'id'> = { ...bad[2], seq: 1 };
  bad[2] = { ...invalidDupSeq, id: recalcKernelEventId(invalidDupSeq as Record<string, unknown>) };
  kernel.loadHistory(bad);

  assert.throws(() => kernel.verify());
});

test('verify: rejects forward causal references', async () => {
  const kernel = new ClankaKernel('run-cause-forward');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const history = kernel.getHistory();
  const forwardLinked: Omit<CognitiveEvent, 'id'> = { ...history[1], causes: [history[2].id] };

  const forwardKernel = new ClankaKernel('run-cause-forward');
  forwardKernel.loadHistory([
    history[0],
    { ...forwardLinked, id: recalcKernelEventId(forwardLinked as Record<string, unknown>) },
    history[2],
  ]);
  assert.throws(() => forwardKernel.verify(), /unknown cause/);
});

test('verify: valid sequence passes', async () => {
  const kernel = new ClankaKernel('run-valid');
  await kernel.log('run.start', 'agent', { msg: 'hello' });
  await kernel.log('run.end', 'agent', { msg: 'done' });
  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
});

test('verify: allows multi-cause links to prior events', async () => {
  const kernel = new ClankaKernel('run-multi-cause');
  const start = await kernel.log('run.start', 'agent', { name: 'multi-cause' });
  const thinkA = await kernel.log('agent.think', 'agent', { branch: 'A' }, [start.id]);
  const thinkB = await kernel.log('agent.think', 'agent', { branch: 'B' }, [start.id]);
  await kernel.log('run.commit', 'agent', { status: 'done' }, [thinkA.id, thinkB.id]);

  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 4);
  assert.deepEqual(kernel.getHistory().map(e => e.seq), [0, 1, 2, 3]);
});

test('verify: throws on seq gap (missing middle event)', async () => {
  const kernel = new ClankaKernel('run-gap');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  // Drop the middle event — history becomes [seq0, seq2]
  const history = kernel.getHistory();
  kernel.loadHistory([history[0], history[2]]);

  assert.throws(() => kernel.verify(), /Sequence gap/);
});

test('verify: throws on unknown cause id', async () => {
  const kernel = new ClankaKernel('run-cause');
  // Reference a cause that was never logged
  await kernel.log('run.end', 'agent', {}, ['nonexistent-cause-id']);
  assert.throws(() => kernel.verify(), /unknown cause/);
});

test('verify: valid causal reference passes', async () => {
  const kernel = new ClankaKernel('run-cause-ok');
  const e0 = await kernel.log('run.start', 'agent', {});
  await kernel.log('run.end', 'agent', {}, [e0.id]);
  const result = kernel.verify();
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
});

test('log: concurrent calls preserve contiguous sequence ordering per kernel', async () => {
  const kernel = new ClankaKernel('run-ordered-concurrent');
  const writes = Array.from({ length: 25 }, (_, i) => kernel.log('agent.think', 'agent', { i }));
  await Promise.all(writes);

  assert.deepEqual(kernel.getHistory().map(e => e.seq), Array.from({ length: 25 }, (_, i) => i));
  assert.equal(kernel.verify().valid, true);
});

test('verify: throws when the first event sequence is not zero', async () => {
  const kernel = new ClankaKernel('run-start-seq');
  await kernel.log('run.start', 'agent', { msg: 'hi' });

  const [first] = kernel.getHistory();
  const shiftedFirst = { ...first, seq: 1 };
  kernel.loadHistory([{ ...shiftedFirst, id: recalcKernelEventId(shiftedFirst as Record<string, unknown>) } as CognitiveEvent]);

  assert.throws(() => kernel.verify(), /Sequence gap/);
});

test('verify: throws when history entries are loaded out of sequence order', async () => {
  const kernel = new ClankaKernel('run-out-of-order');
  await kernel.log('run.start', 'agent', {});
  await kernel.log('run.middle', 'agent', {});
  await kernel.log('run.end', 'agent', {});

  const [e0, e1, e2] = kernel.getHistory();
  kernel.loadHistory([e1, e0, e2]);

  assert.throws(() => kernel.verify(), /Sequence gap/);
});

test('verify: allows replayed events with omitted causes field', async () => {
  const kernel = new ClankaKernel('run-optional-causes');
  await kernel.log('run.start', 'agent', { stage: 'start' });

  const [event] = kernel.getHistory();
  const { causes: _causes, ...withoutCauses } = event as CognitiveEvent & { causes?: string[] };
  const replayEvent = { ...withoutCauses, id: recalcKernelEventId(withoutCauses as Record<string, unknown>) } as CognitiveEvent;

  const replayKernel = new ClankaKernel('run-optional-causes');
  replayKernel.loadHistory([replayEvent]);

  assert.equal(replayKernel.verify().valid, true);
  assert.equal(replayKernel.verify().eventCount, 1);
});

test('registerInvariant: appends invariant.failed after a violating event with causal link', async () => {
  const kernel = new ClankaKernel('run-invariant-failure');
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

  const trigger = await kernel.log('tool.requested', 'agent', { tool: 'bash', cmd: 'ls' });
  const history = kernel.getHistory();

  assert.equal(history.length, 2);
  assert.equal(history[1].type, 'invariant.failed');
  assert.equal(history[1].seq, 1);
  assert.deepEqual(history[1].causes, [trigger.id]);
  assert.equal(history[1].payload.invariant, 'tool_requires_plan');
  assert.equal(kernel.verify().valid, true);
});

test('registerInvariant: concurrent async checks keep invariant.failed cause on the trigger', async () => {
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

test('registerInvariant: multiple failing invariants all record against the same trigger', async () => {
  const kernel = new ClankaKernel('run-multi-invariant');
  kernel.registerInvariant({
    name: 'fail_one',
    description: 'first failure',
    async check(ctx: { event: CognitiveEvent }) {
      if (ctx.event.type === 'boom') {
        return { valid: false, message: 'one', severity: 'error' };
      }
      return { valid: true };
    },
  });
  kernel.registerInvariant({
    name: 'fail_two',
    description: 'second failure',
    async check(ctx: { event: CognitiveEvent }) {
      if (ctx.event.type === 'boom') {
        return { valid: false, message: 'two', severity: 'error' };
      }
      return { valid: true };
    },
  });

  const trigger = await kernel.log('boom', 'agent', {});
  const history = kernel.getHistory();
  const failures = history.filter((event) => event.type === 'invariant.failed');

  assert.equal(history[0].id, trigger.id);
  assert.equal(failures.length, 2);
  assert.deepEqual(
    failures.map((event) => event.payload.invariant).sort(),
    ['fail_one', 'fail_two'],
  );
  assert.equal(failures.every((event) => event.causes[0] === trigger.id), true);
  assert.equal(kernel.verify().valid, true);
});
