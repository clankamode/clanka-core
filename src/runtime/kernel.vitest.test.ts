import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClankaKernel, toCanonical } from './kernel';
import type { CognitiveEvent } from './kernel';
import { EventSchema } from '../../packages/core/event';

afterEach(() => {
  vi.useRealTimers();
});

function withRecomputedId(event: Omit<CognitiveEvent, 'id'>): CognitiveEvent {
  const id = createHash('sha256').update(toCanonical(event)).digest('hex');
  return { ...event, id };
}

describe('runtime event ordering invariants', () => {
  it('maintains monotonic seq and valid backward-only causal links', async () => {
    const kernel = new ClankaKernel('run-ordering');

    const e0 = await kernel.log('run.start', 'agent', { step: 0 });
    const e1 = await kernel.log('agent.think', 'agent', { step: 1 }, [e0.id]);
    const e2 = await kernel.log('run.end', 'agent', { step: 2 }, [e1.id]);

    expect(e0.seq).toBe(0);
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(kernel.verify()).toEqual({ valid: true, eventCount: 3 });
  });

  it('rejects sequence gaps', async () => {
    const kernel = new ClankaKernel('run-ordering-gap');
    await kernel.log('run.start', 'agent', {});
    await kernel.log('agent.think', 'agent', {});
    await kernel.log('run.end', 'agent', {});

    const history = kernel.getHistory();
    kernel.loadHistory([history[0], history[2]]);

    expect(() => kernel.verify()).toThrow(/sequence gap/i);
  });

  it('rejects causal references to future events when digest is still valid', async () => {
    const kernel = new ClankaKernel('run-ordering-invalid-cause');
    await kernel.log('run.start', 'agent', { step: 0 });
    await kernel.log('agent.think', 'agent', { step: 1 });
    await kernel.log('run.end', 'agent', { step: 2 });

    const history = kernel.getHistory();
    const { id: _originalId, ...secondWithoutId } = history[1];
    const mutatedSecond: Omit<CognitiveEvent, 'id'> = {
      ...secondWithoutId,
      causes: [history[2].id],
    };

    const tampered = [
      history[0],
      withRecomputedId(mutatedSecond),
      history[2],
    ];
    kernel.loadHistory(tampered);

    expect(() => kernel.verify()).toThrow(/unknown cause|forward|self-referencing/i);
  });

  it('rejects out-of-order history even when each event digest is intact', async () => {
    const kernel = new ClankaKernel('run-ordering-out-of-order');
    await kernel.log('run.start', 'agent', {});
    await kernel.log('agent.think', 'agent', {});
    await kernel.log('run.end', 'agent', {});

    const [e0, e1, e2] = kernel.getHistory();
    kernel.loadHistory([e1, e0, e2]);

    expect(() => kernel.verify()).toThrow(/sequence gap/i);
  });
});

describe('runtime replay determinism', () => {
  it('produces identical event IDs for identical inputs under fixed time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const k1 = new ClankaKernel('run-det');
    const k2 = new ClankaKernel('run-det');

    await k1.log('run.start', 'agent', { input: 'same' });
    await k1.log('tool.call', 'agent', { tool: 'bash', cmd: 'ls -la' });

    await k2.log('run.start', 'agent', { input: 'same' });
    await k2.log('tool.call', 'agent', { tool: 'bash', cmd: 'ls -la' });

    const h1 = k1.getHistory();
    const h2 = k2.getHistory();
    expect(h1).toHaveLength(h2.length);
    for (let i = 0; i < h1.length; i++) {
      expect(h1[i].id).toBe(h2[i].id);
      expect(h1[i].timestamp).toBe(h2[i].timestamp);
    }
    expect(k1.serialize()).toBe(k2.serialize());
  });

  it('round-trips JSONL replay without mutating event stream', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const original = new ClankaKernel('run-roundtrip');
    await original.log('run.start', 'agent', { input: 'x' });
    await original.log('run.end', 'agent', { output: 'y' });

    const replayed = ClankaKernel.fromJSONL('run-roundtrip', original.serialize());

    expect(replayed.getHistory()).toEqual(original.getHistory());
    expect(replayed.verify()).toEqual({ valid: true, eventCount: 2 });
  });

  it('replaying the same serialized events produces the same state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const original = new ClankaKernel('run-deterministic-replay');
    await original.log('run.start', 'agent', { prompt: 'hello' });
    await original.log('tool.call', 'agent', { tool: 'bash', cmd: 'echo hi' });
    await original.log('run.end', 'agent', { status: 'ok' });

    const jsonl = original.serialize();
    const replayA = ClankaKernel.fromJSONL('run-deterministic-replay', jsonl);
    const replayB = ClankaKernel.fromJSONL('run-deterministic-replay', jsonl);

    expect(replayA.getHistory()).toEqual(replayB.getHistory());
    expect(replayA.serialize()).toBe(replayB.serialize());
    expect(replayA.verify()).toEqual(replayB.verify());
  });

  it('ignores surrounding blank lines during replay and remains deterministic', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const original = new ClankaKernel('run-deterministic-blank-lines');
    await original.log('run.start', 'agent', { prompt: 'blank-lines' });
    await original.log('run.end', 'agent', { status: 'ok' });

    const jsonlWithBlanks = `\n${original.serialize()}\n\n`;
    const replayA = ClankaKernel.fromJSONL('run-deterministic-blank-lines', jsonlWithBlanks);
    const replayB = ClankaKernel.fromJSONL('run-deterministic-blank-lines', jsonlWithBlanks);

    expect(replayA.getHistory()).toEqual(original.getHistory());
    expect(replayA.serialize()).toBe(replayB.serialize());
    expect(replayA.verify()).toEqual({ valid: true, eventCount: 2 });
  });
});

describe('invalid event payloads (zod rejection)', () => {
  it('rejects non-object payloads via EventSchema', () => {
    const invalid = {
      v: 1.1,
      id: 'abc',
      runId: 'run-zod',
      seq: 0,
      type: 'run.started',
      timestamp: 1700000000000,
      causes: [],
      payload: 'not-an-object',
    };

    const parsed = EventSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown event types via EventSchema', () => {
    const invalid = {
      v: 1.1,
      id: 'abc',
      runId: 'run-zod',
      seq: 0,
      type: 'runtime.unknown',
      timestamp: 1700000000000,
      causes: [],
      payload: {},
    };

    const parsed = EventSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed required fields via EventSchema', () => {
    const invalid = {
      v: '1.1',
      id: 123,
      runId: 'run-zod',
      seq: 'zero',
      type: 'run.started',
      timestamp: '1700000000000',
      causes: [42],
      payload: {},
    };

    const parsed = EventSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed meta fields via EventSchema', () => {
    const invalid = {
      v: 1.1,
      id: 'abc',
      runId: 'run-zod',
      seq: 0,
      type: 'run.started',
      timestamp: 1700000000000,
      causes: [],
      payload: {},
      meta: { agentId: 42 },
    };

    const parsed = EventSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects missing payload field via EventSchema', () => {
    const invalid = {
      v: 1.1,
      id: 'abc',
      runId: 'run-zod',
      seq: 0,
      type: 'run.started',
      timestamp: 1700000000000,
      causes: [],
    };

    const parsed = EventSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects non-string cause IDs via EventSchema', () => {
    const invalid = {
      v: 1.1,
      id: 'abc',
      runId: 'run-zod',
      seq: 0,
      type: 'run.started',
      timestamp: 1700000000000,
      causes: ['ok', 42],
      payload: {},
    };

    const parsed = EventSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});

describe('concurrent run isolation', () => {
  it('keeps sequence and run identity isolated across concurrent kernels', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const alpha = new ClankaKernel('run-alpha');
    const beta = new ClankaKernel('run-beta');

    await Promise.all([
      Promise.all([
        alpha.log('run.start', 'agent-a', { run: 'alpha' }),
        alpha.log('agent.step', 'agent-a', { run: 'alpha' }),
        alpha.log('run.end', 'agent-a', { run: 'alpha' }),
      ]),
      Promise.all([
        beta.log('run.start', 'agent-b', { run: 'beta' }),
        beta.log('agent.step', 'agent-b', { run: 'beta' }),
        beta.log('run.end', 'agent-b', { run: 'beta' }),
      ]),
    ]);

    const alphaHistory = alpha.getHistory();
    const betaHistory = beta.getHistory();

    expect(alphaHistory.map(e => e.runId)).toEqual(['run-alpha', 'run-alpha', 'run-alpha']);
    expect(betaHistory.map(e => e.runId)).toEqual(['run-beta', 'run-beta', 'run-beta']);
    expect(alphaHistory.map(e => e.seq)).toEqual([0, 1, 2]);
    expect(betaHistory.map(e => e.seq)).toEqual([0, 1, 2]);
    expect(new Set(alphaHistory.map(e => e.id)).size).toBe(3);
    expect(new Set(betaHistory.map(e => e.id)).size).toBe(3);
  });

  it('does not leak events between run histories under interleaved concurrency', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const runA = new ClankaKernel('run-A');
    const runB = new ClankaKernel('run-B');

    await Promise.all([
      (async () => {
        for (let i = 0; i < 5; i++) {
          await runA.log('agent.step', 'agent-a', { i, run: 'A' });
        }
      })(),
      (async () => {
        for (let i = 0; i < 5; i++) {
          await runB.log('agent.step', 'agent-b', { i, run: 'B' });
        }
      })(),
    ]);

    const historyA = runA.getHistory();
    const historyB = runB.getHistory();

    expect(historyA).toHaveLength(5);
    expect(historyB).toHaveLength(5);
    expect(historyA.every(e => e.runId === 'run-A')).toBe(true);
    expect(historyB.every(e => e.runId === 'run-B')).toBe(true);
    expect(historyA.map(e => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(historyB.map(e => e.seq)).toEqual([0, 1, 2, 3, 4]);

    const idsA = new Set(historyA.map(e => e.id));
    const idsB = new Set(historyB.map(e => e.id));
    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }
  });

  it('verifies each concurrent run independently and keeps serialization isolated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));

    const left = new ClankaKernel('run-left');
    const right = new ClankaKernel('run-right');

    await Promise.all([
      (async () => {
        for (let i = 0; i < 6; i++) {
          await left.log('agent.step', 'agent-left', { i, run: 'left' });
        }
      })(),
      (async () => {
        for (let i = 0; i < 6; i++) {
          await right.log('agent.step', 'agent-right', { i, run: 'right' });
        }
      })(),
    ]);

    expect(left.verify()).toEqual({ valid: true, eventCount: 6 });
    expect(right.verify()).toEqual({ valid: true, eventCount: 6 });
    expect(left.serialize().includes('"run-right"')).toBe(false);
    expect(right.serialize().includes('"run-left"')).toBe(false);
  });
});
