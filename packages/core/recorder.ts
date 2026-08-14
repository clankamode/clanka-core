import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { workspaceHashFromState } from './verify.js';

type FileState = { digest: string; size: number };

/**
 * Minimal log sink used by ClankaRecorder.
 *
 * Matches the (type, agentId, payload, causes) shape historically expected by
 * this recorder. Callers supply the sink — there is no coupling to the
 * published runtime kernel, and this module is not wired into the CLI.
 */
export interface RecorderLogSink {
  log(
    type: string,
    agentId: string,
    payload: Record<string, unknown>,
    causes?: string[],
  ): Promise<{ id: string }>;
}

/**
 * Records tool executions and optional fs.diff / fs.snapshot events into a
 * caller-provided log sink.
 *
 * Not wired into `clanka-core`. `packages/core` is not a workspace package.
 * workspaceHash uses the same `path:digest;…` algorithm as `verify.ts`.
 */
export class ClankaRecorder {
  private workspaceRoot: string;
  private lastEventId?: string;
  /** Cumulative reconstructed FS state from emitted fs.diff events (matches verify). */
  private fsState: Record<string, FileState> = {};

  constructor(
    private sink: RecorderLogSink,
    workspaceRoot?: string,
  ) {
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  public async executeTool(
    toolName: string,
    args: string[],
    caps: { fsWrite?: boolean; outDir?: string } = {},
    causes: string[] = [],
  ): Promise<{ code: number; stdout: string; error?: string }> {
    const callId = Math.random().toString(36).slice(2);
    const txId = `tx_${callId}`;

    const req = await this.sink.log('tool.requested', 'cli', {
      callId,
      txId,
      tool: toolName,
      args,
      caps,
    }, causes);
    this.lastEventId = req.id;

    const scanRoot = caps.outDir ? path.resolve(this.workspaceRoot, caps.outDir) : this.workspaceRoot;
    const preState = this.scanWorkspace(scanRoot);

    const result = await this.spawnTool(toolName, args);

    if (caps.fsWrite) {
      const postState = this.scanWorkspace(scanRoot);
      await this.emitDiffsAndSnapshots(txId, preState, postState, [req.id]);
    }

    const res = await this.sink.log('tool.responded', 'cli', {
      callId,
      txId,
      output: result.stdout,
      exitCode: result.code,
      error: result.error ? { code: 'EXEC_ERROR', message: result.error } : undefined,
    }, [this.lastEventId!]);
    this.lastEventId = res.id;

    return result;
  }

  private async spawnTool(
    command: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; error?: string }> {
    return new Promise((resolve, reject) => {
      // No shell: argv is passed directly (avoids shell injection / quoting lies).
      const proc = spawn(command, args, {
        cwd: this.workspaceRoot,
        shell: false,
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:${path.join(this.workspaceRoot, 'node_modules/.bin')}`,
        },
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      proc.on('error', (err) => {
        reject(err);
      });
      proc.on('close', (code) => {
        resolve({
          code: code ?? 0,
          stdout,
          error: code !== 0 ? stderr : undefined,
        });
      });
    });
  }

  private async emitDiffsAndSnapshots(
    txId: string,
    pre: Map<string, FileState>,
    post: Map<string, FileState>,
    causes: string[],
  ) {
    const touched: string[] = [];
    let currentCauses = causes;

    // Creates and updates
    for (const [relPath, postData] of post.entries()) {
      const preData = pre.get(relPath);
      if (!preData || preData.digest !== postData.digest) {
        touched.push(relPath);
        // beforeDigest must match verify's reconstructed state, not merely disk pre-scan
        const beforeDigest = this.fsState[relPath]?.digest ?? 'null';
        const diff = await this.sink.log('fs.diff', 'kernel', {
          txId,
          path: relPath,
          beforeDigest,
          afterDigest: postData.digest,
          size: postData.size,
          patch: { kind: 'blob', digest: postData.digest },
        }, currentCauses);
        this.fsState[relPath] = { digest: postData.digest, size: postData.size };
        currentCauses = [diff.id];
      }
    }

    // Deletes: gone from post. Only emit when reconstructed state had the path,
    // so beforeDigest matches verify (untracked disk-only files are not in the log).
    for (const [relPath] of pre.entries()) {
      if (post.has(relPath)) continue;
      const beforeDigest = this.fsState[relPath]?.digest ?? 'null';
      if (beforeDigest === 'null') continue;
      touched.push(relPath);
      const diff = await this.sink.log('fs.diff', 'kernel', {
        txId,
        path: relPath,
        beforeDigest,
        afterDigest: 'null',
        patch: { kind: 'blob', digest: 'null' },
      }, currentCauses);
      delete this.fsState[relPath];
      currentCauses = [diff.id];
    }

    const snapshotFiles = touched
      .filter(p => this.fsState[p] !== undefined)
      .map(p => ({ path: p, digest: this.fsState[p].digest, size: this.fsState[p].size }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const snap = await this.sink.log('fs.snapshot', 'kernel', {
      workspaceHash: workspaceHashFromState(this.fsState),
      txId,
      files: snapshotFiles,
    }, currentCauses);
    this.lastEventId = snap.id;
  }

  private scanWorkspace(root: string): Map<string, FileState> {
    const state = new Map<string, FileState>();
    const scan = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const list = fs.readdirSync(dir);
      for (const file of list) {
        if (['node_modules', '.git', 'dist'].includes(file)) continue;
        const fullPath = path.resolve(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) scan(fullPath);
        else {
          const content = fs.readFileSync(fullPath);
          const relPath = path.relative(this.workspaceRoot, fullPath);
          state.set(relPath, {
            digest: createHash('sha256').update(content).digest('hex'),
            size: stat.size,
          });
        }
      }
    };
    scan(root);
    return state;
  }
}
