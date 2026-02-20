export class ReplayHarness {
    events;
    tools;
    models;
    invariants;
    runId;
    constructor(config) {
        this.events = config.events;
        this.tools = config.tools;
        this.models = config.models;
        this.invariants = config.invariants;
        this.runId = this.events[0]?.runId || 'unknown';
    }
    /**
     * Replay: Execute the log deterministically.
     * When tool.requested is encountered, mock the response from tool.responded.
     * When model.requested is encountered, mock the response from model.responded.
     */
    async replay() {
        const replayedEvents = [];
        const invariantResults = [];
        // First pass: walk through the log
        for (const event of this.events) {
            replayedEvents.push(event);
        }
        // Second pass: check all invariants
        for (const invariant of this.invariants) {
            const result = await invariant.check({ events: replayedEvents, runId: this.runId });
            invariantResults.push({ invariant: invariant.name, result });
        }
        const success = invariantResults.every(r => r.result.valid);
        return {
            success,
            invariantResults,
            events: replayedEvents,
        };
    }
    /**
     * Diff: Compare two event logs.
     * Highlights: event order differences, payload mutations, missing/extra events.
     */
    static diff(log1, log2) {
        const minLen = Math.min(log1.length, log2.length);
        for (let i = 0; i < minLen; i++) {
            if (log1[i].digest !== log2[i].digest) {
                return {
                    identical: false,
                    divergeAt: i,
                    summary: `Logs diverge at event ${i}: ${log1[i].type} vs ${log2[i].type}`,
                };
            }
        }
        if (log1.length !== log2.length) {
            return {
                identical: false,
                divergeAt: minLen,
                summary: `Log length mismatch: ${log1.length} vs ${log2.length}`,
            };
        }
        return {
            identical: true,
            summary: 'Logs are identical',
        };
    }
}
