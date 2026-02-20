import { Event } from './event';

export interface InvariantContext {
  events: Event[];
  runId: string;
}

export interface InvariantResult {
  valid: boolean;
  message?: string;
  severity: 'warn' | 'error' | 'fatal';
}

export interface Invariant {
  name: string;
  description: string;
  check: (ctx: InvariantContext) => Promise<InvariantResult>;
}

export const invariant_planBeforeAction = (): Invariant => ({
  name: 'plan_before_action',
  description: 'All tool requests must include a decision in causes[].',
  check: async (ctx) => {
    const { events } = ctx;
    
    const lastEvent = events[events.length - 1];
    if (lastEvent.type === 'tool.requested') {
      const hasDecisionCause = (lastEvent.causes || []).some(causeId => {
        const causeEvent = events.find(e => e.id === causeId);
        return causeEvent && causeEvent.type === 'decision.made';
      });

      if (!hasDecisionCause) {
        return {
          valid: false,
          message: `Tool request ${lastEvent.id} (${lastEvent.payload.tool}) missing decision.made in causes[].`,
          severity: 'error'
        };
      }
    }
    
    return { valid: true, severity: 'warn' };
  },
});
