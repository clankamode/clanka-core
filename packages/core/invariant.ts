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
    const eventsById = new Map(events.map(event => [event.id, event]));

    // Kernel re-logs `invariant.failed` after a violation and re-runs checks.
    // Skip tool requests already attributed to a recorded failure for this rule.
    const alreadyReportedToolIds = new Set(
      events
        .filter(
          event =>
            event.type === 'invariant.failed' &&
            event.payload?.invariant === 'plan_before_action',
        )
        .flatMap(event => {
          const ids: string[] = [];
          if (typeof event.payload?.triggerEventId === 'string') {
            ids.push(event.payload.triggerEventId);
          }
          for (const causeId of event.causes || []) {
            ids.push(causeId);
          }
          return ids;
        }),
    );

    for (const event of events) {
      if (event.type !== 'tool.requested') {
        continue;
      }

      if (alreadyReportedToolIds.has(event.id)) {
        continue;
      }

      const hasDecisionCause = (event.causes || []).some(causeId => {
        const causeEvent = eventsById.get(causeId);
        return causeEvent !== undefined && causeEvent.type === 'decision.made';
      });

      if (!hasDecisionCause) {
        return {
          valid: false,
          message: `Tool request ${event.id} (${event.payload.tool}) missing decision.made in causes[].`,
          severity: 'error',
        };
      }
    }

    return { valid: true, severity: 'warn' };
  },
});
