import { createHash } from 'node:crypto';
import { Event, createEvent, EventType } from './event.js';
import { Invariant } from './invariant.js';
import { EventLogger } from './logger.js';

export interface KernelConfig {
  logger?: EventLogger;
  invariants?: Invariant[];
  v?: number;
}

export class ClankaKernel {
  private runId: string;
  private logger?: EventLogger;
  private invariants: Invariant[] = [];
  private history: Event[] = [];
  private v: number;

  constructor(runId: string, config: KernelConfig = {}) {
    this.runId = runId;
    this.logger = config.logger;
    this.invariants = config.invariants || [];
    this.v = config.v || 1.1;
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
    const event = createEvent(this.v, type, this.runId, seq, payload, causes);
    
    if (meta.agentId || meta.tool || meta.model) {
      event.meta = { ...meta };
      // Re-digest because we modified meta
      const { id: _, ...eventWithoutId } = event;
      const { createHash } = await import('node:crypto');
      const { canonicalJSON } = await import('./event.js');
      event.id = createHash('sha256').update(canonicalJSON(eventWithoutId)).digest('hex');
    }

    this.history.push(event);

    if (this.logger) {
      await this.logger.append(event);
    }

    await this.checkInvariants(event);

    return event;
  }

  private async checkInvariants(triggerEvent: Event) {
    for (const invariant of this.invariants) {
      const result = await invariant.check({ 
        events: this.history, 
        runId: this.runId 
      });

      if (!result.valid) {
        await this.log('invariant.failed', {
          invariant: invariant.name,
          message: result.message || 'No message',
          severity: result.severity,
          triggerEventId: triggerEvent.id,
        }, { agentId: 'kernel' }, [triggerEvent.id]);
      }
    }
  }

  public getHistory(): Event[] {
    return [...this.history];
  }
}
