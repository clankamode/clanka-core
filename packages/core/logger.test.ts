import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { EventLogger, type LoggerConfig } from './logger';
import { contentDigest, createEvent, type Event } from './event';
import { verifyRun } from './verify';

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

function makeEvent({
  id,
  seq,
  timestamp,
  type,
  payload = {},
}: {
  id: string;
  seq: number;
  timestamp: number;
  type: Event['type'];
  payload?: Record<string, unknown>;
}): Event {
  return {
    v: 1.1,
    id,
    runId: 'run-ordering',
    seq,
    type,
    timestamp,
    causes: [],
    payload,
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

test('structured output expands Error context instead of emitting empty objects', () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output, { structuredOutput: true });

  try {
    const logger = new EventLogger('run-error-ctx', config);
    const err = new Error('disk full');
    err.name = 'StorageError';
    logger.error('write failed', { err });

    const entry = JSON.parse(output.toString().trim());
    assert.equal(entry.level, 'error');
    assert.equal(entry.message, 'write failed');
    assert.equal(entry.context.err.name, 'StorageError');
    assert.equal(entry.context.err.message, 'disk full');
    assert.equal(typeof entry.context.err.stack, 'string');
    assert.match(entry.context.err.stack, /disk full/);
  } finally {
    cleanup();
  }
});

test('append writes to JSONL sink, not the console output stream', async () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output);

  try {
    const logger = new EventLogger('run-sink', config);
    await logger.append(
      makeEvent({
        id: 'evt-sink',
        seq: 0,
        timestamp: 100,
        type: 'run.started',
        payload: { ok: true },
      }),
    );

    assert.equal(output.toString(), '');
    const restored = await logger.readLog();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, 'evt-sink');
  } finally {
    cleanup();
  }
});

test('getIndex returns empty metadata when the JSONL file is missing', () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output);

  try {
    const logger = new EventLogger('run-index-empty', config);
    assert.deepEqual(logger.getIndex(), {
      runId: 'run-index-empty',
      eventCount: 0,
    });
  } finally {
    cleanup();
  }
});

test('getIndex reports first/last timestamps after append', async () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output);

  try {
    const logger = new EventLogger('run-index', config);
    await logger.append(
      makeEvent({ id: 'e0', seq: 0, timestamp: 100, type: 'run.started' }),
    );
    await logger.append(
      makeEvent({ id: 'e1', seq: 1, timestamp: 250, type: 'run.finished' }),
    );

    assert.deepEqual(logger.getIndex(), {
      runId: 'run-index',
      eventCount: 2,
      started: 100,
      finished: 250,
    });

    // Second call uses the in-memory metadata, not a fresh full-file seek index.
    assert.deepEqual(logger.getIndex(), {
      runId: 'run-index',
      eventCount: 2,
      started: 100,
      finished: 250,
    });
  } finally {
    cleanup();
  }
});

test('getIndex loads existing JSONL once then tracks further appends', async () => {
  const output = new CaptureStream();
  const { config, cleanup } = makeLoggerConfig(output);

  try {
    const logPath = path.join(config.runsDir, 'run-index-seed.jsonl');
    fs.mkdirSync(config.runsDir, { recursive: true });
    fs.writeFileSync(
      logPath,
      `${JSON.stringify(makeEvent({ id: 'seed', seq: 0, timestamp: 50, type: 'run.started' }))}\n`,
    );

    const logger = new EventLogger('run-index-seed', config);
    assert.deepEqual(logger.getIndex(), {
      runId: 'run-index-seed',
      eventCount: 1,
      started: 50,
      finished: 50,
    });

    await logger.append(
      makeEvent({ id: 'next', seq: 1, timestamp: 75, type: 'run.finished' }),
    );

    assert.deepEqual(logger.getIndex(), {
      runId: 'run-index-seed',
      eventCount: 2,
      started: 50,
      finished: 75,
    });
  } finally {
    cleanup();
  }
});

describe('blob offload', () => {
  test('large payloads stay in JSONL and are mirrored to blob storage', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output, { maxPayloadSize: 32 });

    try {
      const logger = new EventLogger('run-blob', config);
      const payload = { blob: 'x'.repeat(200) };
      await logger.append(
        makeEvent({
          id: 'evt-blob',
          seq: 0,
          timestamp: 100,
          type: 'run.started',
          payload,
        }),
      );

      const logPath = path.join(config.runsDir, 'run-blob.jsonl');
      const raw = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
      assert.deepEqual(raw.payload, payload);
      assert.equal('_blobRef' in raw.payload, false);

      const blobPath = path.join(config.blobsDir, 'run-blob', 'evt-blob.json');
      assert.equal(fs.existsSync(blobPath), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(blobPath, 'utf-8')), payload);

      const restored = await logger.readLog();
      assert.equal(restored.length, 1);
      assert.deepEqual(restored[0].payload, payload);
    } finally {
      cleanup();
    }
  });

  test('large payload JSONL lines keep a verifiable content digest', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output, { maxPayloadSize: 32 });

    try {
      const logger = new EventLogger('run-digest', config);
      const event = createEvent(1.1, 'run.started', 'run-digest', 0, {
        blob: 'z'.repeat(200),
      });
      await logger.append(event);

      const logPath = path.join(config.runsDir, 'run-digest.jsonl');
      const raw = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
      assert.deepEqual(raw.payload, event.payload);

      const { id: actualId, ...eventWithoutId } = raw;
      const recomputed = contentDigest(eventWithoutId);
      assert.equal(actualId, recomputed);
      assert.equal(actualId, event.id);

      const verified = await verifyRun(logPath);
      assert.equal(verified.valid, true);
      assert.equal(verified.eventCount, 1);
    } finally {
      cleanup();
    }
  });

  test('readLog still hydrates legacy {_blobRef} stubs and throws when missing', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output, { maxPayloadSize: 32 });

    try {
      const logger = new EventLogger('run-legacy-blob', config);
      const payload = { blob: 'y'.repeat(200) };
      const blobPath = path.join(config.blobsDir, 'run-legacy-blob', 'evt-legacy.json');
      fs.mkdirSync(path.dirname(blobPath), { recursive: true });
      fs.writeFileSync(blobPath, JSON.stringify(payload, null, 2));

      const legacyLine = JSON.stringify(
        makeEvent({
          id: 'evt-legacy',
          seq: 0,
          timestamp: 100,
          type: 'run.started',
          payload: { _blobRef: 'evt-legacy' },
        }),
      );
      fs.appendFileSync(path.join(config.runsDir, 'run-legacy-blob.jsonl'), `${legacyLine}\n`);

      const restored = await logger.readLog();
      assert.deepEqual(restored[0].payload, payload);

      fs.rmSync(blobPath);
      await assert.rejects(
        () => logger.readLog(),
        /Missing blob for event evt-legacy: evt-legacy/,
      );
    } finally {
      cleanup();
    }
  });
});

describe('append/read ordering', () => {
  test('events are persisted in insertion order', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-ordering', config);
      const inserted = [
        makeEvent({ id: 'e-2', seq: 2, timestamp: 200, type: 'tool.responded' }),
        makeEvent({ id: 'e-0', seq: 0, timestamp: 100, type: 'run.started' }),
        makeEvent({ id: 'e-1', seq: 1, timestamp: 150, type: 'tool.requested' }),
      ];

      for (const event of inserted) {
        await logger.append(event);
      }

      const restored = await logger.readLog();
      assert.deepEqual(
        restored.map(event => event.id),
        inserted.map(event => event.id),
      );
      assert.deepEqual(
        restored.map(event => event.seq),
        [2, 0, 1],
      );
    } finally {
      cleanup();
    }
  });
});

describe('append validation (zod)', () => {
  test('rejects unknown event type', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-invalid-type', config);
      const invalid = {
        ...makeEvent({ id: 'bad-1', seq: 0, timestamp: 100, type: 'run.started' }),
        type: 'not.a.real.type',
      } as unknown as Event;

      await assert.rejects(logger.append(invalid), /Invalid event/);
    } finally {
      cleanup();
    }
  });

  test('rejects non-object payload', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-invalid-payload', config);
      const invalid = {
        ...makeEvent({ id: 'bad-2', seq: 0, timestamp: 100, type: 'run.started' }),
        payload: 'not-an-object',
      } as unknown as Event;

      await assert.rejects(logger.append(invalid), /Invalid event/);
    } finally {
      cleanup();
    }
  });

  test('rejects missing id field', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-missing-id', config);
      const { id: _id, ...withoutId } = makeEvent({
        id: 'bad-3',
        seq: 0,
        timestamp: 100,
        type: 'run.started',
      });

      await assert.rejects(logger.append(withoutId as unknown as Event), /Invalid event/);
    } finally {
      cleanup();
    }
  });

  test('rejects malformed causes field', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-invalid-causes', config);
      const invalid = {
        ...makeEvent({ id: 'bad-4', seq: 0, timestamp: 100, type: 'run.started' }),
        causes: 'not-an-array',
      } as unknown as Event;

      await assert.rejects(logger.append(invalid), /Invalid event/);
    } finally {
      cleanup();
    }
  });

  test('rejects malformed meta field values', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-invalid-meta', config);
      const invalid = {
        ...makeEvent({ id: 'bad-5', seq: 0, timestamp: 100, type: 'run.started' }),
        meta: { agentId: 123 },
      } as unknown as Event;

      await assert.rejects(logger.append(invalid), /Invalid event/);
    } finally {
      cleanup();
    }
  });

  test('accepts a valid event payload', async () => {
    const output = new CaptureStream();
    const { config, cleanup } = makeLoggerConfig(output);

    try {
      const logger = new EventLogger('run-valid-event', config);
      const valid = makeEvent({ id: 'ok-1', seq: 0, timestamp: 100, type: 'run.started' });
      await logger.append(valid);

      const restored = await logger.readLog();
      assert.equal(restored.length, 1);
      assert.equal(restored[0].id, 'ok-1');
      assert.equal(restored[0].type, 'run.started');
    } finally {
      cleanup();
    }
  });
});
