import assert from 'node:assert/strict';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { retry } from './retry.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('retry', () => {
  test('retries synchronous operations with exponential backoff until success', async () => {
    vi.useFakeTimers();

    const attempts: number[] = [];
    const operation = vi.fn((attempt: number) => {
      attempts.push(attempt);
      if (attempt < 3) {
        throw new Error(`failed-${attempt}`);
      }
      return 'ok';
    });

    const pending = retry(operation, {
      maxRetries: 3,
      initialDelayMs: 10,
      backoffFactor: 2,
    });

    await vi.advanceTimersByTimeAsync(9);
    assert.equal(operation.mock.calls.length, 1);

    await vi.advanceTimersByTimeAsync(1);
    assert.equal(operation.mock.calls.length, 2);

    await vi.advanceTimersByTimeAsync(19);
    assert.equal(operation.mock.calls.length, 2);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('ok');
    assert.deepEqual(attempts, [1, 2, 3]);
  });

  test('applies jitter to the computed backoff delay', async () => {
    vi.useFakeTimers();

    const attempts: number[] = [];
    const pending = retry(
      (attempt: number) => {
        attempts.push(attempt);
        if (attempt === 1) {
          throw new Error('retry me');
        }
        return 'ok';
      },
      {
        maxRetries: 1,
        initialDelayMs: 20,
        jitter: { minRatio: 0.5, maxRatio: 0.5 },
      },
    );

    await vi.advanceTimersByTimeAsync(9);
    assert.deepEqual(attempts, [1]);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('ok');
    assert.deepEqual(attempts, [1, 2]);
  });

  test('retries asynchronous operations and rejects after exhausting retries', async () => {
    vi.useFakeTimers();

    const operation = vi.fn(async (attempt: number) => {
      await Promise.resolve();
      throw new Error(`boom-${attempt}`);
    });

    const pending = retry(operation, {
      maxRetries: 2,
      initialDelayMs: 5,
      maxDelayMs: 6,
    });
    const rejection = assert.rejects(pending, /boom-3/);

    await vi.advanceTimersByTimeAsync(5);
    assert.equal(operation.mock.calls.length, 2);

    await vi.advanceTimersByTimeAsync(6);
    await rejection;
    assert.equal(operation.mock.calls.length, 3);
  });

  test('rejects immediately when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop now'));

    const operation = vi.fn(() => 'never');
    await assert.rejects(
      retry(operation, { signal: controller.signal }),
      /stop now/,
    );
    assert.equal(operation.mock.calls.length, 0);
  });

  test('aborts while waiting between retries', async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const operation = vi.fn(() => {
      throw new Error('retry');
    });

    const pending = retry(operation, {
      maxRetries: 3,
      initialDelayMs: 100,
      signal: controller.signal,
    });
    const rejection = assert.rejects(
      pending,
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );

    assert.equal(operation.mock.calls.length, 1);

    controller.abort();

    await rejection;
    assert.equal(operation.mock.calls.length, 1);
  });
});
