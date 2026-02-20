const { createHash } = require('crypto');

function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(item => canonicalJSON(item)).join(',') + ']';
  const sortedKeys = Object.keys(obj).filter(key => obj[key] !== undefined).sort();
  const parts = sortedKeys.map(key => JSON.stringify(key) + ':' + canonicalJSON(obj[key]));
  return '{' + parts.join(',') + '}';
}

function contentDigest(obj) {
  const canonical = canonicalJSON(obj);
  return createHash('sha256').update(canonical).digest('hex');
}

function createDAREvent(v, runId, seq, type, payload, causes = [], meta = {}) {
  const eventData = {
    v,
    runId,
    seq,
    type,
    timestamp: 1740034800000, // Fixed for determinism in golden log
    payload,
    causes,
    meta
  };
  const { id: _, ...eventWithoutId } = eventData;
  const id = contentDigest(eventWithoutId);
  return { ...eventData, id };
}

const runId = "golden-run-001";
const events = [];

events.push(createDAREvent(1.1, runId, 0, "run.started", {}));
events.push(createDAREvent(1.1, runId, 1, "decision.made", { thought: "Check workspace state" }, [events[0].id]));
events.push(createDAREvent(1.1, runId, 2, "tool.requested", { tool: "ls" }, [events[1].id], { agentId: "main", tool: "exec" }));
events.push(createDAREvent(1.1, runId, 3, "tool.responded", { files: [] }, [events[2].id]));
events.push(createDAREvent(1.1, runId, 4, "run.commit", { status: "golden" }, [events[3].id]));

console.log(events.map(e => JSON.stringify(e)).join('\n'));
