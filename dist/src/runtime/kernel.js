import { createHash } from 'node:crypto';
export function toCanonical(obj) {
    if (obj === null || typeof obj !== 'object')
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return '[' + obj.map(item => toCanonical(item)).join(',') + ']';
    const sortedKeys = Object.keys(obj).filter(key => obj[key] !== undefined).sort();
    const parts = sortedKeys.map(key => JSON.stringify(key) + ':' + toCanonical(obj[key]));
    return '{' + parts.join(',') + '}';
}
export class ClankaKernel {
    sessionId;
    state = {
        history: [],
        invariants: [],
    };
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    registerInvariant(invariant) {
        this.state.invariants.push(invariant);
    }
    async log(type, agentId, payload, causes = []) {
        const eventData = {
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
        const event = { ...eventData, id };
        this.state.history.push(event);
        await this.enforceInvariants();
        return event;
    }
    async enforceInvariants() {
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
    getHistory() {
        return [...this.state.history];
    }
}
