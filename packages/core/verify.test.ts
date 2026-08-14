import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRun, toCanonical, workspaceHashFromState } from './verify';
import type { Event } from './event';

function deepDigest(eventWithoutId: Omit<Event, 'id'>): string {
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}

function makeEvent(partial: Partial<Event> & Pick<Event, 'seq' | 'type'>): Event {
  const base: Omit<Event, 'id'> = {
    v: 1.1,
    runId: 'verify-test-run',
    seq: partial.seq,
    type: partial.type,
    timestamp: partial.timestamp ?? 1_700_000_000_000 + partial.seq,
    causes: partial.causes ?? [],
    payload: partial.payload ?? {},
    meta: partial.meta,
  };
  return { ...base, id: deepDigest(base) };
}

function writeRun(events: Event[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-verify-'));
  const filePath = path.join(dir, 'run.jsonl');
  fs.writeFileSync(filePath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return filePath;
}

describe('toCanonical', () => {
  test('includes nested payload keys (not top-level whitelist only)', () => {
    const a = toCanonical({ payload: { name: 'alpha' }, seq: 0 });
    const b = toCanonical({ payload: { name: 'beta' }, seq: 0 });
    assert.notEqual(a, b);
    assert.match(a, /alpha/);
  });
});

describe('verifyRun digest integrity', () => {
  test('module documents that it is not the published clanka-core verify path', () => {
    const source = fs.readFileSync(path.join(__dirname, 'verify.ts'), 'utf8');
    assert.match(source, /Not wired into the published `clanka-core` CLI/);
    assert.match(source, /kernel\.verify\(\)/);
  });

  test('accepts the repo golden run file', async () => {
    const goldenPath = path.resolve(__dirname, '../../runs/golden.jsonl');
    const result = await verifyRun(goldenPath, { strict: true });
    assert.equal(result.valid, true);
    assert.equal(result.eventCount, 5);
  });

  test('accepts a valid run including golden-style deep digests', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started', payload: {} });
    const e1 = makeEvent({
      seq: 1,
      type: 'decision.made',
      payload: { thought: 'Check workspace state' },
      causes: [e0.id],
    });
    const e2 = makeEvent({
      seq: 2,
      type: 'run.commit',
      payload: { status: 'ok' },
      causes: [e1.id],
    });

    const result = await verifyRun(writeRun([e0, e1, e2]));
    assert.equal(result.valid, true);
    assert.equal(result.eventCount, 3);
  });

  test('rejects payload tampering that keeps the original id', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started', payload: { name: 'original' } });
    const tampered = {
      ...e0,
      payload: { name: 'EVIL' },
    };

    await assert.rejects(
      () => verifyRun(writeRun([tampered as Event])),
      /invalid digest/,
    );
  });

  test('rejects shallow digests that ignore payload contents', async () => {
    // Historical broken form: JSON.stringify(obj, Object.keys(obj)) whitelists
    // only top-level keys and drops nested payload fields.
    const brokenCanonical = (obj: Record<string, unknown>) =>
      JSON.stringify(obj, Object.keys(obj).sort());

    const eventWithoutId = {
      v: 1.1,
      runId: 'shallow-run',
      seq: 0,
      type: 'run.started' as const,
      timestamp: 100,
      causes: [] as string[],
      payload: { secret: 'should-be-bound' },
    };
    const shallowId = createHash('sha256')
      .update(brokenCanonical(eventWithoutId))
      .digest('hex');
    const shallowEvent = { ...eventWithoutId, id: shallowId };

    await assert.rejects(
      () => verifyRun(writeRun([shallowEvent as Event])),
      /invalid digest/,
    );
  });

  test('rejects sequence gaps', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started' });
    const e2 = makeEvent({ seq: 2, type: 'run.finished', payload: { status: 'success' }, causes: [e0.id] });

    await assert.rejects(
      () => verifyRun(writeRun([e0, e2])),
      /Sequence gap/,
    );
  });

  test('rejects unknown causes', async () => {
    const e0 = makeEvent({
      seq: 0,
      type: 'run.started',
      causes: ['missing-cause'],
    });

    await assert.rejects(
      () => verifyRun(writeRun([e0])),
      /unknown cause/,
    );
  });

  test('strict mode requires run.commit', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started' });

    await assert.rejects(
      () => verifyRun(writeRun([e0]), { strict: true }),
      /run\.commit/,
    );
  });
});

describe('verifyRun fs replay', () => {
  test('accepts diffs + snapshot when workspaceHash matches reconstructed state', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started' });
    const afterDigest = createHash('sha256').update('hello').digest('hex');
    const e1 = makeEvent({
      seq: 1,
      type: 'fs.diff',
      causes: [e0.id],
      payload: {
        txId: 'tx1',
        path: 'a.txt',
        beforeDigest: 'null',
        afterDigest,
        size: 5,
        patch: { kind: 'blob', digest: afterDigest },
      },
    });
    const hash = workspaceHashFromState({ 'a.txt': { digest: afterDigest, size: 5 } });
    const e2 = makeEvent({
      seq: 2,
      type: 'fs.snapshot',
      causes: [e1.id],
      payload: {
        txId: 'tx1',
        workspaceHash: hash,
        files: [{ path: 'a.txt', digest: afterDigest, size: 5 }],
      },
    });

    const result = await verifyRun(writeRun([e0, e1, e2]));
    assert.equal(result.valid, true);
  });

  test('rejects workspaceHash computed with a different algorithm', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started' });
    const afterDigest = createHash('sha256').update('hello').digest('hex');
    const e1 = makeEvent({
      seq: 1,
      type: 'fs.diff',
      causes: [e0.id],
      payload: {
        txId: 'tx1',
        path: 'a.txt',
        beforeDigest: 'null',
        afterDigest,
        size: 5,
        patch: { kind: 'blob', digest: afterDigest },
      },
    });
    // Old recorder algorithm: JSON.stringify of file list
    const wrongHash = createHash('sha256')
      .update(JSON.stringify([{ path: 'a.txt', digest: afterDigest, size: 5 }]))
      .digest('hex');
    const e2 = makeEvent({
      seq: 2,
      type: 'fs.snapshot',
      causes: [e1.id],
      payload: {
        txId: 'tx1',
        workspaceHash: wrongHash,
        files: [{ path: 'a.txt', digest: afterDigest, size: 5 }],
      },
    });

    await assert.rejects(
      () => verifyRun(writeRun([e0, e1, e2])),
      /workspaceHash mismatch/,
    );
  });

  test('rejects beforeDigest that does not match reconstructed state', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started' });
    const e1 = makeEvent({
      seq: 1,
      type: 'fs.diff',
      causes: [e0.id],
      payload: {
        txId: 'tx1',
        path: 'a.txt',
        beforeDigest: 'deadbeef',
        afterDigest: createHash('sha256').update('x').digest('hex'),
        patch: { kind: 'blob', digest: 'x' },
      },
    });

    await assert.rejects(
      () => verifyRun(writeRun([e0, e1])),
      /beforeDigest mismatch/,
    );
  });

  test('applies deletes (afterDigest null) before hashing snapshot', async () => {
    const e0 = makeEvent({ seq: 0, type: 'run.started' });
    const dig = createHash('sha256').update('bye').digest('hex');
    const e1 = makeEvent({
      seq: 1,
      type: 'fs.diff',
      causes: [e0.id],
      payload: {
        txId: 'tx1',
        path: 'gone.txt',
        beforeDigest: 'null',
        afterDigest: dig,
        size: 3,
        patch: { kind: 'blob', digest: dig },
      },
    });
    const e2 = makeEvent({
      seq: 2,
      type: 'fs.diff',
      causes: [e1.id],
      payload: {
        txId: 'tx2',
        path: 'gone.txt',
        beforeDigest: dig,
        afterDigest: 'null',
        patch: { kind: 'blob', digest: 'null' },
      },
    });
    const emptyHash = workspaceHashFromState({});
    const e3 = makeEvent({
      seq: 3,
      type: 'fs.snapshot',
      causes: [e2.id],
      payload: {
        txId: 'tx2',
        workspaceHash: emptyHash,
        files: [],
      },
    });

    const result = await verifyRun(writeRun([e0, e1, e2, e3]));
    assert.equal(result.valid, true);
  });
});
