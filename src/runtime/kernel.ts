import { createHash } from 'node:crypto';

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
}
