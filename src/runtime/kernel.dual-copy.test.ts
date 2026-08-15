import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  ClankaKernel as SrcKernel,
  EVENT_SCHEMA_VERSION as SrcSchemaVersion,
  toCanonical as srcToCanonical,
  type CognitiveEvent as SrcEvent,
} from './kernel';
import {
  ClankaKernel as PkgKernel,
  EVENT_SCHEMA_VERSION as PkgSchemaVersion,
  toCanonical as pkgToCanonical,
  type CognitiveEvent as PkgEvent,
} from '../../packages/core-runtime/src/runtime/kernel';

type DualEvent = SrcEvent & PkgEvent;

function digestFor(eventWithoutId: Omit<DualEvent, 'id'>): string {
  const srcDigest = createHash('sha256').update(srcToCanonical(eventWithoutId)).digest('hex');
  const pkgDigest = createHash('sha256').update(pkgToCanonical(eventWithoutId)).digest('hex');
  assert.equal(
    srcDigest,
    pkgDigest,
    'src and packages toCanonical digests must agree for dual-copy fixtures',
  );
  return srcDigest;
}

function makeEvent(
  sessionId: string,
  overrides: Partial<DualEvent> & Pick<DualEvent, 'seq' | 'type'>,
): DualEvent {
  const { id: _omitId, ...rest } = overrides;
  const eventWithoutId: Omit<DualEvent, 'id'> = {
    v: SrcSchemaVersion,
    runId: sessionId,
    timestamp: 1_700_000_000_000 + overrides.seq,
    causes: [],
    payload: {},
    meta: { agentId: 'test' },
    ...rest,
    seq: overrides.seq,
    type: overrides.type,
  };
  return { ...eventWithoutId, id: digestFor(eventWithoutId) };
}

function verifyOutcome(run: () => unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: run() };
  } catch (err) {
    assert.ok(err instanceof Error);
    return { ok: false, message: err.message };
  }
}

function assertVerifyParity(sessionId: string, history: DualEvent[]) {
  const src = new SrcKernel(sessionId);
  const pkg = new PkgKernel(sessionId);
  src.loadHistory(history);
  pkg.loadHistory(history);

  const srcOutcome = verifyOutcome(() => src.verify());
  const pkgOutcome = verifyOutcome(() => pkg.verify());

  assert.equal(
    srcOutcome.ok,
    pkgOutcome.ok,
    `verify accept/reject diverged for session ${sessionId}`,
  );
  if (srcOutcome.ok && pkgOutcome.ok) {
    assert.deepEqual(srcOutcome.value, pkgOutcome.value);
    return;
  }
  if (!srcOutcome.ok && !pkgOutcome.ok) {
    assert.equal(
      srcOutcome.message,
      pkgOutcome.message,
      `verify error messages diverged for session ${sessionId}`,
    );
  }
}

test('src and packages ClankaKernel sources are identical', () => {
  const srcPath = path.resolve(__dirname, 'kernel.ts');
  const pkgPath = path.resolve(
    __dirname,
    '../../packages/core-runtime/src/runtime/kernel.ts',
  );
  const src = fs.readFileSync(srcPath, 'utf-8');
  const pkg = fs.readFileSync(pkgPath, 'utf-8');
  assert.equal(
    src,
    pkg,
    'src/runtime/kernel.ts and packages/core-runtime/src/runtime/kernel.ts drifted',
  );
});

test('dual ClankaKernel copies export the same EVENT_SCHEMA_VERSION', () => {
  assert.equal(SrcSchemaVersion, PkgSchemaVersion);
  assert.equal(SrcSchemaVersion, 1.1);
});

test('dual ClankaKernel copies agree on verify for well-formed history', async () => {
  const src = new SrcKernel('run-dual-ok');
  await src.log('run.start', 'agent', { n: 1 });
  await src.log('run.end', 'agent', { n: 2 }, [src.getHistory()[0]!.id]);
  assertVerifyParity('run-dual-ok', src.getHistory() as DualEvent[]);
});

test('dual ClankaKernel copies agree on verify rejections', () => {
  const session = 'run-dual-reject';
  const ok = makeEvent(session, { seq: 0, type: 'run.start' });

  assertVerifyParity(session, [
    makeEvent('other-run', { seq: 0, type: 'run.start' }),
  ]);
  assertVerifyParity(session, [
    makeEvent(session, { seq: 0, type: 'run.start', v: 1 }),
  ]);
  assertVerifyParity(session, [
    makeEvent(session, { seq: 0, type: 'run.start', timestamp: Number.NaN }),
  ]);
  assertVerifyParity(session, [
    ok,
    makeEvent(session, {
      seq: 1,
      type: 'run.end',
      timestamp: ok.timestamp - 1,
      causes: [ok.id],
    }),
  ]);
  assertVerifyParity(session, [
    makeEvent(session, { seq: 1, type: 'run.start' }),
  ]);
  assertVerifyParity(session, [
    ok,
    makeEvent(session, {
      seq: 1,
      type: 'run.end',
      causes: ['missing-cause-id'],
    }),
  ]);

  const later = makeEvent(session, { seq: 1, type: 'run.end', causes: [] });
  const forward = makeEvent(session, {
    seq: 0,
    type: 'run.start',
    causes: [later.id],
  });
  assertVerifyParity(session, [forward, later]);

  const tampered = { ...ok, id: '0'.repeat(64) };
  assertVerifyParity(session, [tampered]);
});

test('dual ClankaKernel copies agree on invariant.failed without re-entry', async () => {
  async function runInvariantCase(Kernel: typeof SrcKernel | typeof PkgKernel) {
    const kernel = new Kernel('run-dual-invariant');
    let checks = 0;
    kernel.registerInvariant({
      name: 'always_fail',
      description: 'fails on every history snapshot',
      async check() {
        checks += 1;
        return { valid: false, message: 'nope', severity: 'error' };
      },
    });
    const trigger = await kernel.log('boom', 'agent', { x: 1 });
    const history = kernel.getHistory();
    return {
      checks,
      historyTypes: history.map((event) => event.type),
      failureCauseIsTrigger: history[1]?.causes?.[0] === trigger.id,
      failureInvariant: history[1]?.payload?.invariant,
      verify: kernel.verify(),
    };
  }

  const srcResult = await runInvariantCase(SrcKernel);
  const pkgResult = await runInvariantCase(PkgKernel);

  assert.deepEqual(srcResult, pkgResult);
  assert.equal(srcResult.checks, 1);
  assert.deepEqual(srcResult.historyTypes, ['boom', 'invariant.failed']);
  assert.equal(srcResult.failureCauseIsTrigger, true);
});

test('dual ClankaKernel copies pin invariant.failed cause to the triggering event', async () => {
  async function runSelective(Kernel: typeof SrcKernel | typeof PkgKernel) {
    const kernel = new Kernel('run-dual-selective');
    kernel.registerInvariant({
      name: 'tool_requires_plan',
      description: 'tool.requested must be justified by a decision',
      async check(ctx: { event: DualEvent }) {
        if (ctx.event.type === 'tool.requested') {
          return { valid: false, message: 'missing decision cause', severity: 'error' };
        }
        return { valid: true };
      },
    });
    const trigger = await kernel.log('tool.requested', 'agent', { tool: 'bash' });
    const history = kernel.getHistory();
    return {
      length: history.length,
      failureType: history[1]?.type,
      causePinnedToTrigger: history[1]?.causes?.[0] === trigger.id,
      verify: kernel.verify(),
    };
  }

  const srcResult = await runSelective(SrcKernel);
  const pkgResult = await runSelective(PkgKernel);
  assert.deepEqual(srcResult, pkgResult);
  assert.equal(srcResult.causePinnedToTrigger, true);
});
