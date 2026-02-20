import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { EventSchema, Event, canonicalJSON } from './event.js';

interface FSState {
  [path: string]: { digest: string; size: number };
}

export async function verifyRun(runPath: string, options: { strict?: boolean } = {}) {
  const content = fs.readFileSync(runPath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.length > 0);
  
  const history: Event[] = [];
  const eventIds = new Set<string>();
  let expectedSeq = 0;
  const fsState: FSState = {};
  const activeTx: Set<string> = new Set();
  const txTouchedPaths: Map<string, Set<string>> = new Map();

  for (const line of lines) {
    // 1. Parse & Schema Validation
    const parseResult = EventSchema.safeParse(JSON.parse(line));
    if (!parseResult.success) {
      throw new Error(`Line ${expectedSeq} failed schema validation: ${parseResult.error.message}`);
    }
    const event = parseResult.data;

    // 2. Digest Verification
    // id = sha256(canonical(event without id))
    const { id: _, ...eventWithoutId } = event;
    const recomputedDigest = createHash('sha256').update(canonicalJSON(eventWithoutId)).digest('hex');
    if (event.id !== recomputedDigest) {
      throw new Error(`Event ${event.seq} (id: ${event.id}) has invalid digest. Expected: ${recomputedDigest}`);
    }

    // 3. Sequence Contiguity
    if (event.seq !== expectedSeq) {
      throw new Error(`Sequence gap. Expected ${expectedSeq}, got ${event.seq}`);
    }

    // 4. Causality Check
    if (event.causes) {
      for (const causeId of event.causes) {
        if (!eventIds.has(causeId)) {
          throw new Error(`Event ${event.seq} has unknown cause: ${causeId}`);
        }
        const causeEvent = history.find(e => e.id === causeId);
        if (causeEvent && causeEvent.seq >= event.seq) {
          throw new Error(`Event ${event.seq} has forward/self-referencing cause: ${causeId}`);
        }
      }
    }

    // 5. FS Replay & Determinism
    if (event.type === 'fs.diff') {
      const { txId, path: filePath, beforeDigest, afterDigest, size } = event.payload;
      if (!txId) throw new Error(`Event ${event.seq}: fs.diff missing txId`);
      
      // Enforce no_file_collision within a txId
      if (!txTouchedPaths.has(txId)) txTouchedPaths.set(txId, new Set());
      if (txTouchedPaths.get(txId)!.has(filePath)) {
        throw new Error(`Event ${event.seq}: File collision in txId ${txId} for path ${filePath}`);
      }
      txTouchedPaths.get(txId)!.add(filePath);

      // Enforce beforeDigest matches current
      const currentState = fsState[filePath];
      const currentDigest = currentState ? currentState.digest : 'null';
      if (beforeDigest !== currentDigest) {
        throw new Error(`Event ${event.seq}: fs.diff beforeDigest mismatch for ${filePath}. Log: ${beforeDigest}, State: ${currentDigest}`);
      }

      // Apply afterDigest
      if (afterDigest === 'null') {
        delete fsState[filePath];
      } else {
        fsState[filePath] = { digest: afterDigest, size: size || 0 };
      }
    }

    if (event.type === 'fs.snapshot') {
      const { txId, files, workspaceHash } = event.payload;
      if (!txId) throw new Error(`Event ${event.seq}: fs.snapshot missing txId`);
      
      // Verify files match state
      for (const file of files) {
        const state = fsState[file.path];
        if (!state || state.digest !== file.digest) {
          throw new Error(`Event ${event.seq}: fs.snapshot file mismatch for ${file.path}`);
        }
      }

      // Recompute workspaceHash
      const paths = Object.keys(fsState).sort();
      const hashContent = paths.map(p => `${p}:${fsState[p].digest}`).join(';');
      const recomputedWorkspaceHash = createHash('sha256').update(hashContent).digest('hex');
      
      if (workspaceHash !== recomputedWorkspaceHash) {
        throw new Error(`Event ${event.seq}: workspaceHash mismatch. Log: ${workspaceHash}, Computed: ${recomputedWorkspaceHash}`);
      }
    }

    eventIds.add(event.id);
    history.push(event);
    expectedSeq++;
  }

  if (options.strict) {
    const hasCommit = history.some(e => e.type === 'run.finished' && e.payload.commit);
    if (!hasCommit) {
      throw new Error(`Strict mode: run.finished with commit hash not found.`);
    }
  }

  return { valid: true, eventCount: history.length };
}
