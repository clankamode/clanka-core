import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createEvent, type Event } from './event';
import { invariant_planBeforeAction } from './invariant';

function withId(event: Event, id: string): Event {
  return { ...event, id };
}

describe('invariant_planBeforeAction', () => {
  test('accepts tool.requested that cites a decision.made cause', async () => {
    const invariant = invariant_planBeforeAction();
    const decision = withId(
      createEvent(1.1, 'decision.made', 'run-1', 0, {
        rationale: 'need listing',
        plan: ['ls'],
      }),
      'decision-1',
    );
    const tool = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 1, { tool: 'bash', args: { cmd: 'ls' } }, [
        'decision-1',
      ]),
      'tool-1',
    );

    const result = await invariant.check({ events: [decision, tool], runId: 'run-1' });
    assert.equal(result.valid, true);
  });

  test('rejects tool.requested with no decision.made in causes', async () => {
    const invariant = invariant_planBeforeAction();
    const tool = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 0, { tool: 'bash' }, []),
      'tool-bad',
    );

    const result = await invariant.check({ events: [tool], runId: 'run-1' });
    assert.equal(result.valid, false);
    assert.match(result.message || '', /tool-bad.*missing decision\.made/);
    assert.equal(result.severity, 'error');
  });

  test('rejects when a mid-log tool.requested violates even if later events follow', async () => {
    const invariant = invariant_planBeforeAction();
    const decision = withId(
      createEvent(1.1, 'decision.made', 'run-1', 0, { rationale: 'ok', plan: ['a'] }),
      'decision-1',
    );
    const badTool = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 1, { tool: 'bash' }, []),
      'tool-bad',
    );
    const finished = withId(
      createEvent(1.1, 'run.finished', 'run-1', 2, { status: 'success' }),
      'finish-1',
    );

    const result = await invariant.check({
      events: [decision, badTool, finished],
      runId: 'run-1',
    });

    assert.equal(result.valid, false);
    assert.match(result.message || '', /tool-bad/);
  });

  test('rejects cause links that point at non-decision events', async () => {
    const invariant = invariant_planBeforeAction();
    const started = withId(createEvent(1.1, 'run.started', 'run-1', 0, { name: 'x' }), 'start-1');
    const tool = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 1, { tool: 'bash' }, ['start-1']),
      'tool-1',
    );

    const result = await invariant.check({ events: [started, tool], runId: 'run-1' });
    assert.equal(result.valid, false);
  });

  test('does not re-fire when the newest event is already this invariant.failed', async () => {
    const invariant = invariant_planBeforeAction();
    const badTool = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 0, { tool: 'bash' }, []),
      'tool-bad',
    );
    const failure = withId(
      createEvent(
        1.1,
        'invariant.failed',
        'run-1',
        1,
        {
          invariant: 'plan_before_action',
          message: 'already recorded',
          severity: 'error',
          triggerEventId: 'tool-bad',
        },
        ['tool-bad'],
      ),
      'fail-1',
    );

    const result = await invariant.check({ events: [badTool, failure], runId: 'run-1' });
    assert.equal(result.valid, true);
  });

  test('still fails later when a prior failure was recorded but another tool lacks a decision', async () => {
    const invariant = invariant_planBeforeAction();
    const badTool1 = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 0, { tool: 'bash' }, []),
      'tool-bad-1',
    );
    const failure = withId(
      createEvent(
        1.1,
        'invariant.failed',
        'run-1',
        1,
        {
          invariant: 'plan_before_action',
          message: 'recorded',
          severity: 'error',
          triggerEventId: 'tool-bad-1',
        },
        ['tool-bad-1'],
      ),
      'fail-1',
    );
    const badTool2 = withId(
      createEvent(1.1, 'tool.requested', 'run-1', 2, { tool: 'rm' }, []),
      'tool-bad-2',
    );

    const result = await invariant.check({
      events: [badTool1, failure, badTool2],
      runId: 'run-1',
    });

    assert.equal(result.valid, false);
    assert.match(result.message || '', /tool-bad-2/);
  });
});
