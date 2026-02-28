const { createHash } = require('crypto');

/**
 * Canonical JSON serialization for consistent hashing.
 * - Sorted keys
 * - No whitespace
 */
export function canonicalJSON(obj: any): string {
  // Simple sorted key serialization
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(item => canonicalJSON(item)).join(',') + ']';
  const sortedKeys = Object.keys(obj).filter(key => obj[key] !== undefined).sort();
  const parts = sortedKeys.map(key => JSON.stringify(key) + ':' + canonicalJSON(obj[key]));
  return '{' + parts.join(',') + '}';
}

/**
 * Content-addressable digest.
 */
export function contentDigest(obj: any): string {
  const canonical = canonicalJSON(obj);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a DAR v1.1 event with auto-generated digest ID.
 * ID = sha256(canonical(event without id))
 */
export function createDAREvent(v: number, runId: string, seq: number, type: string, payload: any, causes: string[] = [], meta: any = {}) {
  const eventData: any = {
    v,
    runId,
    seq,
    type,
    timestamp: Date.now(),
    payload,
    causes,
    meta
  };
  const id = contentDigest(eventData);
  return { ...eventData, id };
}

async function main() {
  const runId = "golden-run-001";
  const events: any[] = [];
  
  // 0. run.started
  events.push(createDAREvent(1.1, runId, 0, "run.started", {}, []));
  
  // 1. decision.made
  events.push(createDAREvent(1.1, runId, 1, "decision.made", { thought: "Check workspace state" }, [events[0].id]));
  
  // 2. tool.requested
  events.push(createDAREvent(1.1, runId, 2, "tool.requested", { tool: "ls" }, [events[1].id], { agentId: "main", tool: "exec" }));
  
  // 3. tool.responded
  events.push(createDAREvent(1.1, runId, 3, "tool.responded", { files: [] }, [events[2].id]));
  
  // 4. run.commit (for strict mode)
  // In v1.1, run.commit usually carries the final state or rolling hash.
  events.push(createDAREvent(1.1, runId, 4, "run.commit", { status: "golden" }, [events[3].id]));

  console.log(events.map(e => JSON.stringify(e)).join('\n'));
}

main();
