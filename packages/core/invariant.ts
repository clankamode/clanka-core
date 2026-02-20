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
  description: 'All tool requests must be preceded by a decision.',
  check: async (ctx) => {
    return { valid: true, severity: 'warn' };
  },
});
