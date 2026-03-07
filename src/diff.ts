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

export interface LineDiffOptions {
  contextLines?: number;
}

export interface FormatLineDiffOptions extends LineDiffOptions {
  maxLines?: number;
  truncationMarker?: string;
}

export interface FormatLineDiffDeps {
  truncateLines?: (lines: string[], maxLines: number, truncationMarker: string) => string[];
  joinLines?: (lines: string[]) => string;
}

type LineChangeKind = 'context' | 'add' | 'remove';

interface LineChange {
  kind: LineChangeKind;
  line: string;
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

/**
 * Compares two event sequences and groups differences by missing and modified events.
 *
 * @param runId1 - Identifier for the first run.
 * @param events1 - Events from the first run keyed by sequence number.
 * @param runId2 - Identifier for the second run.
 * @param events2 - Events from the second run keyed by sequence number.
 * @returns A structured summary of events that were added, removed, or modified.
 */
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

function normalizeInputLines(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return [...input];
  }
  return input.split(/\r?\n/);
}

function buildLineChanges(beforeLines: string[], afterLines: string[]): LineChange[] {
  const n = beforeLines.length;
  const m = afterLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (beforeLines[i] === afterLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      changes.push({ kind: 'context', line: beforeLines[i] });
      i++;
      j++;
      continue;
    }

    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      changes.push({ kind: 'remove', line: beforeLines[i] });
      i++;
    } else {
      changes.push({ kind: 'add', line: afterLines[j] });
      j++;
    }
  }

  while (i < n) {
    changes.push({ kind: 'remove', line: beforeLines[i] });
    i++;
  }
  while (j < m) {
    changes.push({ kind: 'add', line: afterLines[j] });
    j++;
  }

  return changes;
}

function renderLineChange(change: LineChange): string {
  if (change.kind === 'add') return `+${change.line}`;
  if (change.kind === 'remove') return `-${change.line}`;
  return ` ${change.line}`;
}

function renderWithContext(changes: LineChange[], contextLines: number): string[] {
  const changedIndexes: number[] = [];
  for (let idx = 0; idx < changes.length; idx++) {
    if (changes[idx].kind !== 'context') {
      changedIndexes.push(idx);
    }
  }

  if (changedIndexes.length === 0) {
    return [];
  }

  const keep = Array(changes.length).fill(false);
  for (const idx of changedIndexes) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(changes.length - 1, idx + contextLines);
    for (let i = start; i <= end; i++) {
      keep[i] = true;
    }
  }

  const rendered: string[] = [];
  let skipping = false;
  for (let idx = 0; idx < changes.length; idx++) {
    if (!keep[idx]) {
      skipping = true;
      continue;
    }
    if (skipping && rendered.length > 0 && rendered[rendered.length - 1] !== '...') {
      rendered.push('...');
    }
    rendered.push(renderLineChange(changes[idx]));
    skipping = false;
  }

  return rendered;
}

/**
 * Produces a contextual line-by-line diff between two string inputs.
 *
 * @param before - Original text or list of lines.
 * @param after - Updated text or list of lines.
 * @param options - Diff rendering options such as surrounding context lines.
 * @returns Rendered diff lines prefixed with `+`, `-`, or a space for context.
 */
export function diffLines(
  before: string | string[],
  after: string | string[],
  options: LineDiffOptions = {},
): string[] {
  const contextLines = Math.max(0, options.contextLines ?? 3);
  const beforeLines = normalizeInputLines(before);
  const afterLines = normalizeInputLines(after);
  const changes = buildLineChanges(beforeLines, afterLines);
  return renderWithContext(changes, contextLines);
}

/**
 * Limits a rendered diff to a maximum number of lines.
 *
 * @param lines - Rendered diff lines.
 * @param maxLines - Maximum number of lines to keep.
 * @param truncationMarker - Marker appended when lines are omitted.
 * @returns The original lines when they fit, otherwise a truncated copy.
 */
export function truncateDiffLines(
  lines: string[],
  maxLines: number,
  truncationMarker = '... (truncated)',
): string[] {
  if (lines.length <= maxLines) {
    return [...lines];
  }
  if (maxLines <= 1) {
    return [truncationMarker];
  }
  return [...lines.slice(0, maxLines - 1), truncationMarker];
}

/**
 * Generates a formatted line diff string with optional truncation and injected helpers.
 *
 * @param before - Original text or list of lines.
 * @param after - Updated text or list of lines.
 * @param options - Diff rendering and truncation options.
 * @param deps - Optional formatting dependencies for testing or customization.
 * @returns A newline-joined diff string, or an empty string when there are no changes.
 */
export function formatLineDiff(
  before: string | string[],
  after: string | string[],
  options: FormatLineDiffOptions = {},
  deps: FormatLineDiffDeps = {},
): string {
  const truncationMarker = options.truncationMarker ?? '... (truncated)';
  let lines = diffLines(before, after, options);
  if (lines.length === 0) {
    return '';
  }

  if (typeof options.maxLines === 'number') {
    const truncate = deps.truncateLines ?? truncateDiffLines;
    lines = truncate(lines, options.maxLines, truncationMarker);
  }

  const joinLines = deps.joinLines ?? ((parts: string[]) => parts.join('\n'));
  return joinLines(lines);
}

/**
 * Serializes a payload to JSON and shortens it for compact display.
 *
 * @param payload - Value to serialize.
 * @param maxLength - Maximum output length including the ellipsis.
 * @returns A JSON string representation, truncated when necessary.
 */
export function summarizePayload(payload: unknown, maxLength = 80): string {
  const s = JSON.stringify(payload);
  return s.length > maxLength ? s.slice(0, maxLength - 3) + '...' : s;
}

/**
 * Formats a run diff summary as Markdown.
 *
 * @param diff - Structured diff data returned by {@link diffRuns}.
 * @returns Markdown describing added, removed, and modified events.
 */
export function formatDiffMarkdown(diff: RunDiffResult): string {
  const lines: string[] = [];
  lines.push(`## Run Diff: ${diff.runId1} vs ${diff.runId2}`);
  lines.push('');

  lines.push(`### Only in ${diff.runId1} (${diff.onlyInRun1.length} events)`);
  if (diff.onlyInRun1.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of diff.onlyInRun1) {
      lines.push(`- [${e.type}] ${summarizePayload(e.payload)}`);
    }
  }
  lines.push('');

  lines.push(`### Only in ${diff.runId2} (${diff.onlyInRun2.length} events)`);
  if (diff.onlyInRun2.length === 0) {
    lines.push('_none_');
  } else {
    for (const e of diff.onlyInRun2) {
      lines.push(`- [${e.type}] ${summarizePayload(e.payload)}`);
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
