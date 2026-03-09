export interface RetryJitterOptions {
  minRatio?: number;
  maxRatio?: number;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitter?: boolean | RetryJitterOptions;
  signal?: AbortSignal;
}

export type RetryOperation<T> = (attempt: number) => T | Promise<T>;

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function assertNonNegativeNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0`);
  }
}

function normalizeJitter(jitter: RetryOptions['jitter']): RetryJitterOptions | null {
  if (jitter === undefined || jitter === false) {
    return null;
  }

  if (jitter === true) {
    return { minRatio: 0, maxRatio: 1 };
  }

  const minRatio = jitter.minRatio ?? 0;
  const maxRatio = jitter.maxRatio ?? 1;

  if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio) || minRatio < 0 || maxRatio < 0) {
    throw new RangeError('jitter ratios must be finite non-negative numbers');
  }

  if (minRatio > maxRatio) {
    throw new RangeError('jitter minRatio must be less than or equal to maxRatio');
  }

  return { minRatio, maxRatio };
}

function createAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error(signal.reason === undefined ? 'Operation aborted' : String(signal.reason));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function computeDelayMs(attempt: number, options: Required<Pick<RetryOptions, 'initialDelayMs' | 'maxDelayMs' | 'backoffFactor'>> & {
  jitter: RetryJitterOptions | null;
}): number {
  const unclampedDelay = options.initialDelayMs * Math.pow(options.backoffFactor, attempt - 1);
  const cappedDelay = Math.min(unclampedDelay, options.maxDelayMs);

  if (options.jitter === null) {
    return cappedDelay;
  }

  const { minRatio = 0, maxRatio = 1 } = options.jitter;
  const jitterRatio = minRatio + ((maxRatio - minRatio) * Math.random());
  return cappedDelay * jitterRatio;
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(createAbortError(signal as AbortSignal));
    };

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  });
}

export async function retry<T>(
  operation: RetryOperation<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
  const backoffFactor = options.backoffFactor ?? 2;
  const jitter = normalizeJitter(options.jitter);

  assertNonNegativeInteger(maxRetries, 'maxRetries');
  assertNonNegativeNumber(initialDelayMs, 'initialDelayMs');
  if (maxDelayMs !== Number.POSITIVE_INFINITY) {
    assertNonNegativeNumber(maxDelayMs, 'maxDelayMs');
  }
  assertPositiveNumber(backoffFactor, 'backoffFactor');

  let attempt = 1;
  while (true) {
    throwIfAborted(options.signal);

    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt > maxRetries) {
        throw error;
      }

      const delayMs = computeDelayMs(attempt, {
        initialDelayMs,
        maxDelayMs,
        backoffFactor,
        jitter,
      });

      await wait(delayMs, options.signal);
      attempt += 1;
    }
  }
}
