import { describe, expect, it, vi, afterEach } from 'vitest';
import { ClankaKernel } from './kernel';
import { EventSchema } from '../../packages/core/event';

afterEach(() => {
  vi.useRealTimers();
});

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

  it('rejects forward/self causal references during verify', async () => {
    const kernel = new ClankaKernel('run-ordering-invalid-cause');
    await kernel.log('run.start', 'agent', {});
    await kernel.log('run.end', 'agent', {});

    const history = kernel.getHistory();
    const badSecond = { ...history[1], causes: [history[1].id] };
    kernel.loadHistory([history[0], badSecond]);

    expect(() => kernel.verify()).toThrow(/invalid digest/i);
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
});
