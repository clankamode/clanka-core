import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClankaKernel } from './kernel';
import type { CognitiveEvent } from './kernel';

test('concurrent log calls remain isolated per kernel', async () => {
  const alpha = new ClankaKernel('run-alpha');
  const beta = new ClankaKernel('run-beta');
  const alphaSteps = Array.from({ length: 20 }, (_, i) => alpha.log('agent.think', 'agent-a', { i }));
  const betaSteps = Array.from({ length: 20 }, (_, i) => beta.log('agent.think', 'agent-b', { i }));
  await Promise.all([Promise.all(alphaSteps), Promise.all(betaSteps)]);

  const historyA = alpha.getHistory();
  const historyB = beta.getHistory();

  assert.equal(historyA.length, 20);
  assert.equal(historyB.length, 20);
  assert.deepEqual(
    historyA.map(e => e.runId),
    Array.from({ length: 20 }, () => 'run-alpha'),
  );
  assert.deepEqual(
    historyB.map(e => e.runId),
    Array.from({ length: 20 }, () => 'run-beta'),
  );
  assert.deepEqual(
    historyA.map(e => e.seq),
    Array.from({ length: 20 }, (_, i) => i),
  );
  assert.deepEqual(
    historyB.map(e => e.seq),
    Array.from({ length: 20 }, (_, i) => i),
  );
});

test('interleaved concurrent logging does not mix histories', async () => {
  const alpha = new ClankaKernel('run-alpha-mix');
  const beta = new ClankaKernel('run-beta-mix');
  const alphaWrites = Array.from({ length: 12 }, (_, i) =>
    Promise.resolve().then(() => alpha.log('agent.think', 'agent-a', { i })),
  );
  const betaWrites = Array.from({ length: 12 }, (_, i) =>
    Promise.resolve().then(() => beta.log('agent.think', 'agent-b', { i })),
  );

  await Promise.all([...alphaWrites, ...betaWrites]);

  const historyA = alpha.getHistory();
  const historyB = beta.getHistory();

  assert.deepEqual(historyA.map(e => e.runId), Array.from({ length: 12 }, () => 'run-alpha-mix'));
  assert.deepEqual(historyB.map(e => e.runId), Array.from({ length: 12 }, () => 'run-beta-mix'));
  assert.deepEqual(historyA.map(e => e.seq), Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(historyB.map(e => e.seq), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(new Set(historyA.map(e => e.id)).size, historyA.length);
  assert.equal(new Set(historyB.map(e => e.id)).size, historyB.length);
});

test('concurrent run logging does not leak event ids across histories', async () => {
  const alpha = new ClankaKernel('run-alpha-isolated');
  const beta = new ClankaKernel('run-beta-isolated');

  const alphaEvents = [];
  const betaEvents = [];

  for (let i = 0; i < 10; i++) {
    alphaEvents.push(alpha.log('model.requested', 'agent-a', { requestId: `a-${i}` }));
    betaEvents.push(beta.log('model.requested', 'agent-b', { requestId: `b-${i}` }));
  }

  await Promise.all([...alphaEvents, ...betaEvents]);

  const historyA = alpha.getHistory();
  const historyB = beta.getHistory();
  const idsA = new Set(historyA.map(e => e.id));
  const idsB = new Set(historyB.map(e => e.id));

  assert.equal(idsA.size, historyA.length);
  assert.equal(idsB.size, historyB.length);
  for (const id of idsA) {
    assert.ok(!idsB.has(id));
  }
});

test('concurrent runs with identical payloads still produce distinct ids by runId', async () => {
  const fixedNow = 1700000002000;
  const originalNow = Date.now;
  (Date as unknown as { now: () => number }).now = () => fixedNow;

  try {
    const alpha = new ClankaKernel('run-alpha-same-payload');
    const beta = new ClankaKernel('run-beta-same-payload');

    const [a, b] = await Promise.all([
      alpha.log('model.requested', 'agent', { prompt: 'same' }),
      beta.log('model.requested', 'agent', { prompt: 'same' }),
    ]);

    assert.notEqual(a.id, b.id);
    assert.equal(alpha.verify().valid, true);
    assert.equal(beta.verify().valid, true);
  } finally {
    (Date as unknown as { now: () => number }).now = originalNow;
  }
});

test('interleaved concurrent runs verify independently', async () => {
  const alpha = new ClankaKernel('run-alpha-verify');
  const beta = new ClankaKernel('run-beta-verify');

  await Promise.all([
    (async () => {
      for (let i = 0; i < 8; i++) {
        await alpha.log('agent.think', 'agent-a', { i, run: 'alpha' });
      }
    })(),
    (async () => {
      for (let i = 0; i < 8; i++) {
        await beta.log('agent.think', 'agent-b', { i, run: 'beta' });
      }
    })(),
  ]);

  assert.equal(alpha.verify().valid, true);
  assert.equal(beta.verify().valid, true);
  assert.deepEqual(alpha.getHistory().map(e => e.seq), Array.from({ length: 8 }, (_, i) => i));
  assert.deepEqual(beta.getHistory().map(e => e.seq), Array.from({ length: 8 }, (_, i) => i));
});

test('serialize: each run output only contains its own runId under concurrency', async () => {
  const alpha = new ClankaKernel('run-alpha-serialize');
  const beta = new ClankaKernel('run-beta-serialize');

  await Promise.all([
    alpha.log('run.start', 'agent-a', { run: 'alpha' }),
    alpha.log('run.end', 'agent-a', { run: 'alpha' }),
    beta.log('run.start', 'agent-b', { run: 'beta' }),
    beta.log('run.end', 'agent-b', { run: 'beta' }),
  ]);

  const alphaEvents = alpha.serialize().split('\n').filter(Boolean).map(line => JSON.parse(line) as CognitiveEvent);
  const betaEvents = beta.serialize().split('\n').filter(Boolean).map(line => JSON.parse(line) as CognitiveEvent);

  assert.equal(alphaEvents.every(e => e.runId === 'run-alpha-serialize'), true);
  assert.equal(betaEvents.every(e => e.runId === 'run-beta-serialize'), true);
});
