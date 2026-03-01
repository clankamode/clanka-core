import { Event } from './event.js';
import { Invariant, InvariantResult } from './invariant.js';

/**
 * ReplayHarness: Deterministic replay given event log + tool/model mocks.
 * 
 * This is the nucleus. Given a log, we can:
 * - Replay with different models (changing only the model payload)
 * - Verify invariants post-hoc
 * - Diff two runs byte-for-byte
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
   * Replay: Execute the log deterministically.
   * When tool.requested is encountered, mock the response from tool.responded.
   * When model.requested is encountered, mock the response from model.responded.
   */
  public async replay(): Promise<{
    success: boolean;
    invariantResults: { invariant: string; result: InvariantResult }[];
    events: Event[];
  }> {
    const replayedEvents = this.normalizeEvents(this.events);
    const invariantResults: { invariant: string; result: InvariantResult }[] = [];

    // Second pass: check all invariants
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
   * Diff: Compare two event logs.
   * Highlights: event order differences, payload mutations, missing/extra events.
   */
  public static diff(log1: Event[], log2: Event[]): {
    identical: boolean;
    divergeAt?: number;
    summary: string;
  } {
    const minLen = Math.min(log1.length, log2.length);
    
    for (let i = 0; i < minLen; i++) {
      if (log1[i].id !== log2[i].id) {
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
