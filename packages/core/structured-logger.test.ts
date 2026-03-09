import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createLogger } from './index';

class CaptureWriter {
  private readonly chunks: string[] = [];

  public write(chunk: string): void {
    this.chunks.push(chunk);
  }

  public toString(): string {
    return this.chunks.join('');
  }

  public entries(): unknown[] {
    return this.toString()
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line));
  }
}

const FIXED_TIMESTAMP = '2026-03-08T08:00:00.000Z';

test('createLogger is exported and emits JSON entries for all log levels', () => {
  const output = new CaptureWriter();
  const logger = createLogger({
    level: 'debug',
    output,
    module: 'runtime.kernel',
    requestId: 'req-1',
    traceId: 'trace-1',
    now: () => FIXED_TIMESTAMP,
  });

  assert.equal(typeof createLogger, 'function');

  logger.debug('debug message');
  logger.info('info message');
  logger.warn('warn message');
  logger.error('error message');

  const entries = output.entries() as Array<{
    timestamp: string;
    level: string;
    message: string;
    context: Record<string, unknown>;
  }>;

  assert.deepEqual(
    entries.map(entry => entry.level),
    ['debug', 'info', 'warn', 'error'],
  );
  assert.deepEqual(
    entries.map(entry => entry.timestamp),
    [FIXED_TIMESTAMP, FIXED_TIMESTAMP, FIXED_TIMESTAMP, FIXED_TIMESTAMP],
  );
  assert.deepEqual(
    entries.map(entry => entry.message),
    ['debug message', 'info message', 'warn message', 'error message'],
  );

  for (const entry of entries) {
    assert.deepEqual(entry.context, {
      module: 'runtime.kernel',
      requestId: 'req-1',
      traceId: 'trace-1',
    });
  }
});

test('child loggers inherit parent context and merge child and call context', () => {
  const output = new CaptureWriter();
  const parent = createLogger({
    level: 'debug',
    output,
    module: 'runtime',
    requestId: 'req-parent',
    traceId: 'trace-parent',
    context: { service: 'core' },
    now: () => FIXED_TIMESTAMP,
  });
  const child = parent.child({ module: 'runtime.kernel', operation: 'replay' });

  child.info('child message', { attempt: 2 });
  parent.info('parent message');

  const entries = output.entries() as Array<{
    timestamp: string;
    level: string;
    message: string;
    context: Record<string, unknown>;
  }>;

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    timestamp: FIXED_TIMESTAMP,
    level: 'info',
    message: 'child message',
    context: {
      module: 'runtime.kernel',
      requestId: 'req-parent',
      traceId: 'trace-parent',
      service: 'core',
      operation: 'replay',
      attempt: 2,
    },
  });
  assert.deepEqual(entries[1], {
    timestamp: FIXED_TIMESTAMP,
    level: 'info',
    message: 'parent message',
    context: {
      module: 'runtime',
      requestId: 'req-parent',
      traceId: 'trace-parent',
      service: 'core',
    },
  });
});

test('log levels filter lower-priority entries', () => {
  const cases: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    expectedLevels: string[];
  }> = [
    { level: 'debug', expectedLevels: ['debug', 'info', 'warn', 'error'] },
    { level: 'info', expectedLevels: ['info', 'warn', 'error'] },
    { level: 'warn', expectedLevels: ['warn', 'error'] },
    { level: 'error', expectedLevels: ['error'] },
  ];

  for (const { level, expectedLevels } of cases) {
    const output = new CaptureWriter();
    const logger = createLogger({
      level,
      output,
      now: () => FIXED_TIMESTAMP,
    });

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    const entries = output.entries() as Array<{
      timestamp: string;
      level: string;
      message: string;
      context: Record<string, unknown>;
    }>;

    assert.deepEqual(
      entries.map(entry => entry.level),
      expectedLevels,
    );
    assert.ok(entries.every(entry => entry.timestamp === FIXED_TIMESTAMP));
    assert.ok(entries.every(entry => Object.keys(entry.context).length === 0));
  }
});

test('silent mode suppresses output for parent and child loggers', () => {
  const output = new CaptureWriter();
  const logger = createLogger({
    level: 'debug',
    output,
    silent: true,
    now: () => FIXED_TIMESTAMP,
  });

  logger.error('suppressed parent');
  logger.child({ requestId: 'req-silent' }).warn('suppressed child');

  assert.equal(output.toString(), '');
});
