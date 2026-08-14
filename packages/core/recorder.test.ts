import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ClankaKernel } from '../../src/runtime/kernel';
import { ClankaRecorder } from './recorder';
import { verifyRun, workspaceHashFromState } from './verify';

function digestOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
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

    const kernel = new ClankaKernel('recorder-verify-roundtrip');
    const recorder = new ClankaRecorder(kernel, root);

    await recorder.executeTool('node', [script], { fsWrite: true, outDir });

    const history = kernel.getHistory();
    const runPath = path.join(root, 'run.jsonl');
    fs.writeFileSync(runPath, history.map(e => JSON.stringify(e)).join('\n') + '\n');

    const result = await verifyRun(runPath);
    assert.equal(result.valid, true);
    assert.ok(result.eventCount >= 3);

    const snapshot = history.find(e => e.type === 'fs.snapshot');
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

    const kernel = new ClankaKernel('recorder-delete');
    const recorder = new ClankaRecorder(kernel, root);

    await recorder.executeTool('node', [createScript], { fsWrite: true, outDir });

    assert.ok(
      kernel.getHistory().some(e => e.type === 'fs.diff' && e.payload.afterDigest !== 'null'),
      'expected create/update diff before delete',
    );

    await recorder.executeTool('node', [deleteScript], { fsWrite: true, outDir });

    const history = kernel.getHistory();
    const diffs = history.filter(e => e.type === 'fs.diff');
    assert.ok(
      diffs.some(e => e.payload.afterDigest === 'null' && String(e.payload.path).endsWith('victim.txt')),
      'expected a delete diff',
    );

    const runPath = path.join(root, 'run.jsonl');
    fs.writeFileSync(runPath, history.map(e => JSON.stringify(e)).join('\n') + '\n');
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

    const kernel = new ClankaKernel('recorder-patch');
    const recorder = new ClankaRecorder(kernel, root);

    await recorder.executeTool('node', [script], { fsWrite: true, outDir });

    const diff = kernel.getHistory().find(e => e.type === 'fs.diff');
    assert.ok(diff);
    assert.equal(diff!.payload.patch.kind, 'blob');
    assert.equal(diff!.payload.patch.text, undefined);
  });
});
