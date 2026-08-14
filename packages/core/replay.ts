import { Event } from './event.js';
import { Invariant, InvariantResult } from './invariant.js';

/**
 * ReplayHarness: normalize an in-memory event list and run invariants.
 *
 * Behavior (nothing more):
 * - Deduplicate by event id (last-write-wins)
 * - Sort by timestamp, then type, then seq, then id
 * - Evaluate registered invariants
 * - Diff two logs by full event equality
 *
 * This is not tool/model re-execution. It does not load JSONL from disk.
 * It is not the published `clanka-core replay` CLI path (that uses kernel history).
 */

/** Retained only so existing type re-exports keep compiling. Not used by ReplayHarness. */
export interface MockTool {
  name: string;
  simulate: (input: Record<string, any>) => Promise<Record<string, any>>;
}

/** Retained only so existing type re-exports keep compiling. Not used by ReplayHarness. */
export interface MockModel {
  name: string;
  simulate: (prompt: string) => Promise<string>;
}

export interface ReplayConfig {
  events: Event[];
  invariants: Invariant[];
  /**
   * Ignored. Accepted so older call sites that passed `tools: {}` still typecheck.
   * ReplayHarness never invokes tool mocks.
   */
  tools?: Record<string, MockTool>;
  /**
   * Ignored. Accepted so older call sites that passed `models: {}` still typecheck.
   * ReplayHarness never invokes model mocks.
   */
  models?: Record<string, MockModel>;
}

export class ReplayHarness {
  private events: Event[];
  private invariants: Invariant[];
  private runId: string;

  constructor(config: ReplayConfig) {
    this.events = config.events;
    this.invariants = config.invariants;
    this.runId = this.events[0]?.runId || 'unknown';
    // config.tools / config.models are intentionally unread.
  }

  private normalizeEvents(events: Event[]): Event[] {
    // Keep the last copy for duplicate IDs so ordering is deterministic.
    const lastById = new Map<string, Event>();
    for (const event of events) {
      lastById.set(event.id, event);
    }

    return Array.from(lastById.values()).sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      if (a.seq !== b.seq) {
        return a.seq - b.seq;
      }
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Normalize the log and evaluate invariants.
   */
  public async replay(): Promise<{
    success: boolean;
    invariantResults: { invariant: string; result: InvariantResult }[];
    events: Event[];
  }> {
    const replayedEvents = this.normalizeEvents(this.events);
    const invariantResults: { invariant: string; result: InvariantResult }[] = [];

    for (const invariant of this.invariants) {
      const result = await invariant.check({ events: replayedEvents, runId: this.runId });
      invariantResults.push({ invariant: invariant.name, result });
    }

    const success = invariantResults.every(r => r.result.valid);

    return {
      success,
      invariantResults,
      events: replayedEvents,
    };
  }

  /**
   * Diff two event logs by full equality of each event (not id-only).
   */
  public static diff(log1: Event[], log2: Event[]): {
    identical: boolean;
    divergeAt?: number;
    summary: string;
  } {
    const minLen = Math.min(log1.length, log2.length);

    for (let i = 0; i < minLen; i++) {
      if (!eventsEqual(log1[i], log2[i])) {
        return {
          identical: false,
          divergeAt: i,
          summary: `Logs diverge at event ${i}: ${log1[i].type} vs ${log2[i].type}`,
        };
      }
    }

    if (log1.length !== log2.length) {
      return {
        identical: false,
        divergeAt: minLen,
        summary: `Log length mismatch: ${log1.length} vs ${log2.length}`,
      };
    }

    return {
      identical: true,
      summary: 'Logs are identical',
    };
  }
}

function eventsEqual(a: Event, b: Event): boolean {
  return (
    a.id === b.id
    && a.v === b.v
    && a.runId === b.runId
    && a.seq === b.seq
    && a.type === b.type
    && a.timestamp === b.timestamp
    && JSON.stringify(a.causes ?? []) === JSON.stringify(b.causes ?? [])
    && JSON.stringify(a.payload) === JSON.stringify(b.payload)
    && JSON.stringify(a.meta ?? null) === JSON.stringify(b.meta ?? null)
  );
}
