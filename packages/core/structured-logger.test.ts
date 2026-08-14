import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createLogger as createLoggerFromIndex } from './index';
import { createLogger } from './structured-logger';

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

test('createLogger is exported from index and module sink emits JSON for all levels', () => {
  assert.equal(createLoggerFromIndex, createLogger);
  assert.equal(typeof createLogger, 'function');

  const output = new CaptureWriter();
  const logger = createLogger({
    level: 'debug',
    output,
    module: 'runtime.kernel',
    requestId: 'req-1',
    traceId: 'trace-1',
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

test('default level is info so debug is a documented no-op unless level is lowered', () => {
  const output = new CaptureWriter();
  const logger = createLogger({
    output,
    now: () => FIXED_TIMESTAMP,
  });

  logger.debug('hidden by default');
  logger.info('visible by default');

  const entries = output.entries() as Array<{
    timestamp: string;
    level: string;
    message: string;
    context: Record<string, unknown>;
  }>;

  assert.deepEqual(entries, [
    {
      timestamp: FIXED_TIMESTAMP,
      level: 'info',
      message: 'visible by default',
      context: {},
    },
  ]);
});

test('Error context values keep name/message/stack for callers to parse', () => {
  const output = new CaptureWriter();
  const logger = createLogger({
    level: 'debug',
    output,
    now: () => FIXED_TIMESTAMP,
  });

  const cause = new Error('root cause');
  const err = new Error('boom', { cause });
  err.name = 'ProbeError';

  logger.error('failed', { err, attempt: 3 });

  const [entry] = output.entries() as Array<{
    timestamp: string;
    level: string;
    message: string;
    context: {
      attempt: number;
      err: { name: string; message: string; stack?: string; cause?: { message: string } };
    };
  }>;

  assert.equal(entry.level, 'error');
  assert.equal(entry.message, 'failed');
  assert.equal(entry.context.attempt, 3);
  assert.equal(entry.context.err.name, 'ProbeError');
  assert.equal(entry.context.err.message, 'boom');
  assert.equal(typeof entry.context.err.stack, 'string');
  assert.match(String(entry.context.err.stack), /boom/);
  assert.equal(entry.context.err.cause?.message, 'root cause');
});

test('undefined context keys are omitted; null and nested fields are preserved', () => {
  const output = new CaptureWriter();
  const logger = createLogger({
    level: 'info',
    output,
    context: { keep: true, drop: undefined },
    now: () => FIXED_TIMESTAMP,
  });

  logger.info('fields', {
    present: 'yes',
    absent: undefined,
    empty: null,
    nested: { a: 1, b: undefined },
  });

  const [entry] = output.entries() as Array<{
    context: Record<string, unknown>;
  }>;

  assert.deepEqual(entry.context, {
    keep: true,
    present: 'yes',
    empty: null,
    nested: { a: 1 },
  });
  assert.equal('drop' in entry.context, false);
  assert.equal('absent' in entry.context, false);
});
