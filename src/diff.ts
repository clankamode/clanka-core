import type { CognitiveEvent } from './runtime/kernel.js';

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ModifiedEvent {
  seq: number;
  type: string;
  event1: CognitiveEvent;
  event2: CognitiveEvent;
  fieldDiffs: FieldDiff[];
}

export interface RunDiffResult {
  runId1: string;
  runId2: string;
  onlyInRun1: CognitiveEvent[];
  onlyInRun2: CognitiveEvent[];
  modified: ModifiedEvent[];
}

function flattenPayload(obj: unknown, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (obj === null || typeof obj !== 'object') {
    result[prefix || '.'] = obj;
    return result;
  }
  if (Array.isArray(obj)) {
    result[prefix] = JSON.stringify(obj);
    return result;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenPayload(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function compareEvents(e1: CognitiveEvent, e2: CognitiveEvent): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Compare type
  if (e1.type !== e2.type) {
    diffs.push({ field: 'type', oldValue: e1.type, newValue: e2.type });
  }

  // Compare causes as serialized arrays
  if (JSON.stringify(e1.causes) !== JSON.stringify(e2.causes)) {
    diffs.push({ field: 'causes', oldValue: e1.causes, newValue: e2.causes });
  }

  // Compare payload fields (flattened)
  const flat1 = flattenPayload(e1.payload, 'payload');
  const flat2 = flattenPayload(e2.payload, 'payload');
  const allKeys = new Set([...Object.keys(flat1), ...Object.keys(flat2)]);
  for (const key of [...allKeys].sort()) {
    const v1 = flat1[key];
    const v2 = flat2[key];
    if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      diffs.push({ field: key, oldValue: v1, newValue: v2 });
    }
  }

  return diffs;
}

export function diffRuns(
  runId1: string,
  events1: CognitiveEvent[],
  runId2: string,
  events2: CognitiveEvent[],
): RunDiffResult {
  const map1 = new Map(events1.map(e => [e.seq, e]));
  const map2 = new Map(events2.map(e => [e.seq, e]));

  const onlyInRun1: CognitiveEvent[] = [];
  const onlyInRun2: CognitiveEvent[] = [];
  const modified: ModifiedEvent[] = [];

  const allSeqs = new Set([...map1.keys(), ...map2.keys()]);
  for (const seq of [...allSeqs].sort((a, b) => a - b)) {
    const e1 = map1.get(seq);
    const e2 = map2.get(seq);
    if (e1 && !e2) {
      onlyInRun1.push(e1);
    } else if (!e1 && e2) {
      onlyInRun2.push(e2);
    } else if (e1 && e2) {
      const fieldDiffs = compareEvents(e1, e2);
      if (fieldDiffs.length > 0) {
        modified.push({ seq, type: e1.type, event1: e1, event2: e2, fieldDiffs });
      }
    }
  }

  return { runId1, runId2, onlyInRun1, onlyInRun2, modified };
}

function payloadSummary(payload: unknown): string {
  const s = JSON.stringify(payload);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

export function formatDiffMarkdown(diff: RunDiffResult): string {
  const lines: string[] = [];
  lines.push(`## Run Diff: ${diff.runId1} vs ${diff.runId2}`);
  lines.push('');

  lines.push(`### Only in ${diff.runId1} (${diff.onlyInRun1.length} events)`);
  if (diff.onlyInRun1.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of diff.onlyInRun1) {
      lines.push(`- [${e.type}] ${payloadSummary(e.payload)}`);
    }
  }
  lines.push('');

  lines.push(`### Only in ${diff.runId2} (${diff.onlyInRun2.length} events)`);
  if (diff.onlyInRun2.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of diff.onlyInRun2) {
      lines.push(`- [${e.type}] ${payloadSummary(e.payload)}`);
    }
  }
  lines.push('');

  lines.push(`### Modified events (${diff.modified.length} events)`);
  if (diff.modified.length === 0) {
    lines.push('_none_');
  } else {
    for (const m of diff.modified) {
      for (const fd of m.fieldDiffs) {
        lines.push(
          `- [${m.type}]: ${fd.field} changed ${JSON.stringify(fd.oldValue)} → ${JSON.stringify(fd.newValue)}`,
        );
      }
    }
  }

  return lines.join('\n');
}
