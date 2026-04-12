import { createHash } from 'node:crypto';
import { toCanonical } from './kernel';

/** Recompute digest id for tampered/replayed events (same rules as ClankaKernel). */
export function recalcKernelEventId(event: Record<string, unknown>): string {
  const { id: _, ...eventWithoutId } = event as Record<string, unknown> & { id?: string };
  return createHash('sha256').update(toCanonical(eventWithoutId)).digest('hex');
}
