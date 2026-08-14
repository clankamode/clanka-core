import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ClankaRecorder, type RecorderLogSink } from './recorder';
import { verifyRun, workspaceHashFromState, toCanonical } from './verify';
import type { Event } from './event';

function digestOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** In-memory sink with deep digests — no src/runtime dependency. */
class MemoryLogSink implements RecorderLogSink {
  readonly history: Event[] = [];
  constructor(private readonly runId: string) {}

  async log(
    type: string,
    agentId: string,
    payload: Record<string, unknown>,
    causes: string[] = [],
  ): Promise<{ id: string }> {
    const eventWithoutId = {
      v: 1.1,
      runId: this.runId,
      seq: this.history.length,
      type: type as Event['type'],
      timestamp: 1_700_000_000_000 + this.history.length,
      causes,
      payload,
      meta: { agentId },
    };
    const id = createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
    const event = { ...eventWithoutId, id } as Event;
    this.history.push(event);
    return { id };
  }
}

function writeScript(root: string, name: string, source: string): string {
  const scriptPath = path.join(root, name);
  fs.writeFileSync(scriptPath, source);
  return scriptPath;
}

describe('ClankaRecorder fs honesty', () => {
  test('fsWrite emits diffs/snapshot that verifyRun accepts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-recorder-'));
    const outDir = 'out';
    fs.mkdirSync(path.join(root, outDir));
    const target = path.join(outDir, 'a.txt');
    const script = writeScript(
      root,
      'write.js',
      `require('fs').writeFileSync(${JSON.stringify(path.join(root, target))}, 'hello');`,
    );

    const sink = new MemoryLogSink('recorder-verify-roundtrip');
    const recorder = new ClankaRecorder(sink, root);

    await recorder.executeTool('node', [script], { fsWrite: true, outDir });

    const runPath = path.join(root, 'run.jsonl');
    fs.writeFileSync(runPath, sink.history.map(e => JSON.stringify(e)).join('\n') + '\n');

    const result = await verifyRun(runPath);
    assert.equal(result.valid, true);
    assert.ok(result.eventCount >= 3);

    const snapshot = sink.history.find(e => e.type === 'fs.snapshot');
    assert.ok(snapshot);
    const expectedHash = workspaceHashFromState({
      [target]: { digest: digestOf('hello'), size: 5 },
    });
    assert.equal(snapshot!.payload.workspaceHash, expectedHash);
  });

  test('records deletes so reconstructed state drops the path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-recorder-del-'));
    const outDir = 'out';
    fs.mkdirSync(path.join(root, outDir));
    const filePath = path.join(root, outDir, 'victim.txt');

    const createScript = writeScript(
      root,
      'create.js',
      `require('fs').writeFileSync(${JSON.stringify(filePath)}, 'temp');`,
    );
    const deleteScript = writeScript(
      root,
      'delete.js',
      `require('fs').unlinkSync(${JSON.stringify(filePath)});`,
    );

    const sink = new MemoryLogSink('recorder-delete');
    const recorder = new ClankaRecorder(sink, root);

    await recorder.executeTool('node', [createScript], { fsWrite: true, outDir });

    assert.ok(
      sink.history.some(e => e.type === 'fs.diff' && e.payload.afterDigest !== 'null'),
      'expected create/update diff before delete',
    );

    await recorder.executeTool('node', [deleteScript], { fsWrite: true, outDir });

    const diffs = sink.history.filter(e => e.type === 'fs.diff');
    assert.ok(
      diffs.some(e => e.payload.afterDigest === 'null' && String(e.payload.path).endsWith('victim.txt')),
      'expected a delete diff',
    );

    const runPath = path.join(root, 'run.jsonl');
    fs.writeFileSync(runPath, sink.history.map(e => JSON.stringify(e)).join('\n') + '\n');
    const result = await verifyRun(runPath);
    assert.equal(result.valid, true);
  });

  test('uses blob patches instead of fake unified patch text', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-recorder-patch-'));
    const outDir = 'out';
    fs.mkdirSync(path.join(root, outDir));
    const filePath = path.join(root, outDir, 'b.txt');
    const script = writeScript(
      root,
      'write.js',
      `require('fs').writeFileSync(${JSON.stringify(filePath)}, 'x');`,
    );

    const sink = new MemoryLogSink('recorder-patch');
    const recorder = new ClankaRecorder(sink, root);

    await recorder.executeTool('node', [script], { fsWrite: true, outDir });

    const diff = sink.history.find(e => e.type === 'fs.diff');
    assert.ok(diff);
    assert.equal(diff!.payload.patch.kind, 'blob');
    assert.equal(diff!.payload.patch.text, undefined);
  });

  test('spawns without shell (metacharacters are literal argv, not shell syntax)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanka-recorder-noshell-'));
    const sink = new MemoryLogSink('recorder-noshell');
    const recorder = new ClankaRecorder(sink, root);

    // With shell:true this would run `true` and succeed; with shell:false the
    // entire string is the executable name and spawn fails with ENOENT.
    await assert.rejects(
      () => recorder.executeTool('true; false', []),
      (err: NodeJS.ErrnoException) => err.code === 'ENOENT',
    );
  });

  test('does not import published runtime kernel (sink is injected)', () => {
    const source = fs.readFileSync(path.join(__dirname, 'recorder.ts'), 'utf8');
    assert.equal(/\bfrom\s+['"][^'"]*runtime\/kernel['"]/.test(source), false);
    assert.equal(source.includes("shell: true"), false);
    assert.match(source, /shell:\s*false/);
  });
});
