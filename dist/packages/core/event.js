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
export const EventSchema = z.object({
    id: z.string().describe('UUID v4'),
    runId: z.string().describe('Root run identifier'),
    parentId: z.string().optional().describe('Causal parent (for causality chain)'),
    type: EventTypeSchema,
    timestamp: z.number().describe('Unix ms'),
    // Payload: flexible, type-dependent
    payload: z.record(z.string(), z.any()),
    // Content hash for deterministic diffs
    digest: z.string().describe('SHA256 of canonical JSON'),
    // Metadata
    agent: z.string().optional(),
    tool: z.string().optional(),
    model: z.string().optional(),
});
/**
 * Canonical JSON serialization for consistent hashing.
 * - Sorted keys
 * - No whitespace
 */
export function canonicalJSON(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}
/**
 * Content-addressable digest.
 */
export function contentDigest(obj) {
    const canonical = canonicalJSON(obj);
    return createHash('sha256').update(canonical).digest('hex');
}
/**
 * Create an event with auto-generated digest and ID.
 */
export function createEvent(type, runId, payload, parentId) {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const eventData = {
        id,
        runId,
        parentId,
        type,
        timestamp,
        payload,
    };
    const digest = contentDigest(eventData);
    return {
        ...eventData,
        digest,
    };
}
