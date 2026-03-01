import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { EventLogger, type LoggerConfig } from './logger';

class CaptureStream extends Writable {
  private chunks: string[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  public toString(): string {
    return this.chunks.join('');
  }
}

function makeLoggerConfig(
  output: Writable,
  overrides: Partial<LoggerConfig> = {}
): { config: LoggerConfig; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-logger-test-'));
  const config: LoggerConfig = {
    runsDir: path.join(root, 'runs'),
    blobsDir: path.join(root, 'blobs'),
    maxPayloadSize: 32,
    output,
    ...overrides,
  };

  return {
    config,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('log levels debug/info/warn/error all emit correctly', () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output);

  try {
    const logger = new EventLogger('run-levels', config);
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    const lines = output.toString().trim().split('\n');
    assert.equal(lines.length, 4);
    assert.equal(lines[0], '[debug] debug message');
    assert.equal(lines[1], '[info] info message');
    assert.equal(lines[2], '[warn] warn message');
    assert.equal(lines[3], '[error] error message');
  } finally {
    cleanup();
  }
});

test('log with context object serializes context in output', () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output);

  try {
    const logger = new EventLogger('run-context', config);
    logger.info('with context', { runId: 'run-context', attempt: 2 });

    const line = output.toString().trim();
    assert.ok(line.startsWith('[info] with context '));
    assert.ok(line.includes('{"runId":"run-context","attempt":2}'));
  } finally {
    cleanup();
  }
});

test('structured output flag --json emits JSON lines', () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output, { cliArgs: ['--json'] });

  try {
    const logger = new EventLogger('run-json', config);
    logger.info('json enabled', { runId: 'run-json' });
    logger.error('json failure');

    const lines = output.toString().trim().split('\n');
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]);
    assert.equal(first.level, 'info');
    assert.equal(first.message, 'json enabled');
    assert.deepEqual(first.context, { runId: 'run-json' });
    assert.equal(typeof first.timestamp, 'number');

    const second = JSON.parse(lines[1]);
    assert.equal(second.level, 'error');
    assert.equal(second.message, 'json failure');
    assert.equal(typeof second.timestamp, 'number');
  } finally {
    cleanup();
  }
});
