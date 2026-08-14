import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Event, EventType } from './event.js';
import { Invariant } from './invariant.js';
import { EventLogger } from './logger.js';

export interface EventLogKernelConfig {
  logger?: EventLogger;
  invariants?: Invariant[];
  v?: number;
}

/** Same shape as runtime kernel.verify(): digest + seq + causes only. */
export interface EventLogVerifyResult {
  valid: boolean;
  eventCount: number;
}

/**
 * Recursive canonical JSON for EventLog digests (matches src/runtime/kernel.ts).
 * Do not use event.canonicalJSON for digests: JSON.stringify(obj, Object.keys(obj))
 * strips nested payload keys and collapses distinct events onto the same id.
 */
export function toCanonical(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map((item) => toCanonical(item)).join(',') + ']';
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  const parts = sortedKeys.map(
    (key) => JSON.stringify(key) + ':' + toCanonical(record[key])
  );
  return '{' + parts.join(',') + '}';
}

function digestEvent(eventWithoutId: Omit<Event, 'id'>): string {
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}

/**
 * EventLog-typed in-memory kernel for packages/core modules.
 * Not the operator ClankaKernel — that lives in src/runtime (published via
 * @clankamode/core / @clankamode/core-runtime). Operator `clanka-core verify`
 * calls runtime kernel.verify() (digest/seq/causes), not EventLog verifyRun.
 */
export class EventLogKernel {
  private runId: string;
  private logger?: EventLogger;
  private invariants: Invariant[] = [];
  private history: Event[] = [];
  private v: number;
  private checkingInvariants = false;

  constructor(runId: string, config: EventLogKernelConfig = {}) {
    this.runId = runId;
    this.logger = config.logger;
    this.invariants = config.invariants || [];
    this.v = config.v ?? 1.1;
  }

  public registerInvariant(invariant: Invariant) {
    this.invariants.push(invariant);
  }

  public async log(
    type: EventType,
    payload: Record<string, any>,
    meta: { agentId?: string; tool?: string; model?: string } = {},
    causes: string[] = []
  ): Promise<Event> {
    const seq = this.history.length;
    const eventWithoutId: Omit<Event, 'id'> = {
      v: this.v,
      runId: this.runId,
      seq,
      type,
      timestamp: Date.now(),
      causes,
      payload,
    };

    if (meta.agentId || meta.tool || meta.model) {
      eventWithoutId.meta = { ...meta };
    }

    const event: Event = {
      ...eventWithoutId,
      id: digestEvent(eventWithoutId),
    };

    this.history.push(event);

    if (this.logger) {
      await this.logger.append(event);
    }

    await this.checkInvariants(event);

    return event;
  }

  private async checkInvariants(triggerEvent: Event) {
    if (this.checkingInvariants) return;
    this.checkingInvariants = true;
    try {
      for (const invariant of this.invariants) {
        const result = await invariant.check({
          events: this.history,
          runId: this.runId,
        });

        if (!result.valid) {
          await this.log(
            'invariant.failed',
            {
              invariant: invariant.name,
              message: result.message || 'No message',
              severity: result.severity,
              triggerEventId: triggerEvent.id,
            },
            { agentId: 'kernel' },
            [triggerEvent.id]
          );
        }
      }
    } finally {
      this.checkingInvariants = false;
    }
  }

  public getHistory(): Event[] {
    return [...this.history];
  }

  public loadHistory(history: Event[]) {
    this.history = [...history];
  }

  public serialize(): string {
    return this.history.map((event) => JSON.stringify(event)).join('\n');
  }

  /** Digest / seq / causes — same contract as runtime ClankaKernel.verify(). */
  public verify(): EventLogVerifyResult {
    const eventIds = new Set<string>();
    const idToSeq = new Map<string, number>();

    for (let expectedSeq = 0; expectedSeq < this.history.length; expectedSeq++) {
      const event = this.history[expectedSeq];
      const { id: actualId, ...eventWithoutId } = event;
      const recomputedDigest = digestEvent(eventWithoutId);

      if (actualId !== recomputedDigest) {
        throw new Error(
          `Event ${event.seq} has invalid digest. Expected: ${recomputedDigest}`
        );
      }

      if (event.seq !== expectedSeq) {
        throw new Error(`Sequence gap. Expected ${expectedSeq}, got ${event.seq}`);
      }

      for (const causeId of event.causes || []) {
        if (!eventIds.has(causeId)) {
          throw new Error(`Event ${event.seq} has unknown cause: ${causeId}`);
        }
        const causeSeq = idToSeq.get(causeId) ?? -1;
        if (causeSeq >= event.seq) {
          throw new Error(
            `Event ${event.seq} has forward or self-referencing cause: ${causeId}`
          );
        }
      }

      eventIds.add(event.id);
      idToSeq.set(event.id, event.seq);
    }

    return { valid: true, eventCount: this.history.length };
  }

  public static fromJSONL(runId: string, jsonl: string): EventLogKernel {
    const kernel = new EventLogKernel(runId);
    const lines = jsonl
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const history = lines.map((line) => JSON.parse(line) as Event);
    kernel.loadHistory(history);
    return kernel;
  }

  public static loadFromFile(runId: string, runsDir = 'runs'): EventLogKernel {
    const runPath = path.join(runsDir, `${runId}.jsonl`);
    const content = fs.readFileSync(runPath, 'utf-8');
    return EventLogKernel.fromJSONL(runId, content);
  }
}
