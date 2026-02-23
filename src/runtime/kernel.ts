import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CognitiveEvent {
  v: number;
  id: string;
  runId: string;
  seq: number;
  type: string;
  timestamp: number;
  causes: string[];
  payload: any;
  meta?: { agentId?: string };
}

export interface Invariant {
  name: string;
  description: string;
  check: (ctx: any) => Promise<any>;
}

export interface RuntimeState {
  history: CognitiveEvent[];
  invariants: Invariant[];
}

export interface VerifyResult {
  valid: boolean;
  eventCount: number;
}

export function toCanonical(obj: any): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(item => toCanonical(item)).join(',') + ']';
  const sortedKeys = Object.keys(obj).filter(key => obj[key] !== undefined).sort();
  const parts = sortedKeys.map(key => JSON.stringify(key) + ':' + toCanonical(obj[key]));
  return '{' + parts.join(',') + '}';
}

export class ClankaKernel {
  private state: RuntimeState = {
    history: [],
    invariants: [],
  };

  constructor(private sessionId: string) {}

  public registerInvariant(invariant: Invariant) {
    this.state.invariants.push(invariant);
  }

  public async log(
    type: string, 
    agentId: string, 
    payload: any, 
    causes: string[] = []
  ): Promise<CognitiveEvent> {
    const eventData: any = {
      v: 1.1,
      runId: this.sessionId,
      seq: this.state.history.length,
      type,
      timestamp: Date.now(),
      causes,
      payload,
      meta: { agentId }
    };

    // Digest-based ID
    const id = createHash('sha256').update(toCanonical(eventData)).digest('hex');
    const event = { ...eventData, id } as CognitiveEvent;

    this.state.history.push(event);
    await this.enforceInvariants();
    return event;
  }

  private async enforceInvariants() {
    for (const invariant of this.state.invariants) {
      const result = await invariant.check({ events: this.state.history, runId: this.sessionId });
      if (!result.valid) {
        await this.log('invariant.failed', 'kernel', {
          invariant: invariant.name,
          message: result.message || 'No message',
          severity: result.severity,
        }, [this.state.history[this.state.history.length - 1].id]);
      }
    }
  }

  public getHistory() {
    return [...this.state.history];
  }

  public loadHistory(history: CognitiveEvent[]) {
    this.state.history = [...history];
  }

  public serialize(): string {
    return this.state.history.map(event => JSON.stringify(event)).join('\n');
  }

  public verify(): VerifyResult {
    const eventIds = new Set<string>();
    const idToSeq = new Map<string, number>();

    for (let expectedSeq = 0; expectedSeq < this.state.history.length; expectedSeq++) {
      const event = this.state.history[expectedSeq];
      const { id: actualId, ...eventWithoutId } = event;
      const recomputedDigest = createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');

      if (actualId !== recomputedDigest) {
        throw new Error(`Event ${event.seq} has invalid digest. Expected: ${recomputedDigest}`);
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
          throw new Error(`Event ${event.seq} has forward or self-referencing cause: ${causeId}`);
        }
      }

      eventIds.add(event.id);
      idToSeq.set(event.id, event.seq);
    }

    return { valid: true, eventCount: this.state.history.length };
  }

  public static fromJSONL(runId: string, jsonl: string): ClankaKernel {
    const kernel = new ClankaKernel(runId);
    const lines = jsonl.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const history = lines.map(line => JSON.parse(line) as CognitiveEvent);
    kernel.loadHistory(history);
    return kernel;
  }

  public static loadFromFile(runId: string, runsDir = 'runs'): ClankaKernel {
    const runPath = path.join(runsDir, `${runId}.jsonl`);
    const content = fs.readFileSync(runPath, 'utf-8');
    return ClankaKernel.fromJSONL(runId, content);
  }
}
