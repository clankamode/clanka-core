import { Event } from './event.js';
import { Invariant, InvariantResult } from './invariant.js';

/**
 * ReplayHarness: deterministic inspection of an event log.
 *
 * Given a log, this harness:
 * - Deduplicates by event id (last-write-wins) and sorts for stable order
 * - Runs registered invariants against the normalized sequence
 * - Diffs two logs by full event equality (id, type, seq, payload, …)
 *
 * Tool/model mocks may be supplied for API compatibility with callers that
 * prepare them, but `replay()` does not invoke them. It does not re-execute
 * tools or models; it normalizes and verifies the recorded sequence.
 */

export interface MockTool {
  name: string;
  simulate: (input: Record<string, any>) => Promise<Record<string, any>>;
}

export interface MockModel {
  name: string;
  simulate: (prompt: string) => Promise<string>;
}

export interface ReplayConfig {
  events: Event[];
  tools: Record<string, MockTool>;
  models: Record<string, MockModel>;
  invariants: Invariant[];
}

export class ReplayHarness {
  private events: Event[];
  private tools: Record<string, MockTool>;
  private models: Record<string, MockModel>;
  private invariants: Invariant[];
  private runId: string;

  constructor(config: ReplayConfig) {
    this.events = config.events;
    this.tools = config.tools;
    this.models = config.models;
    this.invariants = config.invariants;
    this.runId = this.events[0]?.runId || 'unknown';
  }

  /** Exposed for tests/diagnostics: mocks are retained but not called by replay(). */
  public get registeredTools(): Readonly<Record<string, MockTool>> {
    return this.tools;
  }

  public get registeredModels(): Readonly<Record<string, MockModel>> {
    return this.models;
  }

  private normalizeEvents(events: Event[]): Event[] {
    // Keep the last copy for duplicate IDs so replay is deterministic.
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
   * Does not call tool/model mocks.
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
   * Diff: Compare two event logs for full equality of each event.
   * Diverges on the first index where events differ (any field), or on length mismatch.
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
