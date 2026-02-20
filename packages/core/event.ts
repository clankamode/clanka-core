import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Event Schema: The foundation of deterministic agent runtimes.
 * 
 * Key principles:
 * - Content-addressable (digest = SHA256 of canonical JSON)
 * - Causally linked (parentId chains events)
 * - Immutable append-only log
 */

export const EventTypeSchema = z.enum([
  'run.started',
  'run.finished',
  'agent.started',
  'agent.finished',
  'model.requested',
  'model.responded',
  'tool.requested',
  'tool.responded',
  'fs.snapshot',
  'fs.diff',
  'decision.made',
  'invariant.failed',
  'budget.exhausted',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  v: z.number().describe('Schema version'),
  id: z.string().describe('Digest ID'),
  runId: z.string().describe('Root run identifier'),
  seq: z.number().describe('Monotonic sequence'),
  type: EventTypeSchema,
  timestamp: z.number().describe('Unix ms'),
  causes: z.array(z.string()).optional().describe('Causal links (parent IDs)'),
  payload: z.record(z.string(), z.any()),
  meta: z.object({
    agentId: z.string().optional(),
    tool: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
});

export type Event = z.infer<typeof EventSchema>;

/**
 * Canonical JSON serialization for consistent hashing.
 * - Sorted keys
 * - No whitespace
 */
export function canonicalJSON(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Content-addressable digest.
 */
export function contentDigest(obj: any): string {
  const canonical = canonicalJSON(obj);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create an event with auto-generated digest ID.
 */
export function createEvent(
  v: number,
  type: EventType,
  runId: string,
  seq: number,
  payload: Record<string, any>,
  causes: string[] = []
): Event {
  const timestamp = Date.now();
  
  const eventData: any = {
    v,
    runId,
    seq,
    type,
    timestamp,
    causes,
    payload,
  };
  
  const id = contentDigest(eventData);
  
  return {
    ...eventData,
    id,
  };
}
