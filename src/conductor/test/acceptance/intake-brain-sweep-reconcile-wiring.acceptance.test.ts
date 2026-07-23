// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "intake claim closed-issue guard + brain
// reconciliation sweep" (brain-sweep wiring half — TR-6's "wired into
// intakeTick" criterion).
//
// Stories: .docs/stories/intake-claim-closed-issue-guard-and-brain-sweep.md
// Plan:    .docs/plans/intake-claim-closed-issue-guard-and-brain-sweep.md
//
// Scope note (writing-system-tests §3a): `reconcileClosedIssues` itself
// (forget-closed-pending, status scoping, per-entry resilience, dry-run — the
// TR-6 core / TR-7 / TR-8 / TR-9 acceptance criteria) is a SINGLE-OPERATION
// call from every caller's perspective and is already covered task-by-task by
// the plan's own colocated unit tests (Tasks 10-14,
// reconcile-closed-issues.test.ts) — generating a duplicate acceptance spec
// against a not-yet-decided internal deps shape would freeze an unconfirmed
// assumption (writing-system-tests' correctness gate) rather than test real
// behavior. What is NOT single-operation, and not covered anywhere else, is
// the WIRING: does a real intake tick actually invoke the sweep? That crosses
// two operations (tick, then reconcile) and is exactly the case #3b exists
// for — a `reconcileClosedIssues` unit test passing in isolation proves
// nothing about whether `intakeTick` (the real per-tick entry point the brain
// loop calls every cycle, per intake-loop.ts's own docs) actually reaches it.
//
// Drives the REAL, already-existing `intakeTick` (intake-loop.ts) — Task 15
// pins the exact seam this spec exercises: an optional
// `reconcile?: () => Promise<unknown>` added to `IntakeLoopDeps`, invoked
// inside `intakeTick` in a try/catch. `poll`/`enqueue`/`notify`/`log` are
// faked (per the intake-loop module's own established zero-real-I/O
// convention, see background-intake-conduct-loop.test.ts) — irrelevant to
// this wiring question. `reconcile` is a fake here too; the deps object is
// cast `as any` because `IntakeLoopDeps` does not carry `reconcile` yet
// (pre-implementation) — the RED signal is the runtime assertion below
// failing today (reconcile is never invoked), not a type error.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { intakeTick, type IntakeLoopDeps } from '../../src/engine/engineer/intake/intake-loop.js';

function baseDeps(over: Record<string, unknown> = {}): IntakeLoopDeps {
  return {
    poll: async () => [],
    enqueue: async () => {},
    notify: async () => {},
    now: () => new Date('2026-07-22T00:00:00.000Z'),
    log: () => {},
    ...over,
  } as IntakeLoopDeps;
}

describe('TR-6 — the brain sweep is wired into intakeTick', () => {
  it('a tick invokes the injected reconcile effect exactly once, after the poll/enqueue phase', async () => {
    const order: string[] = [];
    let reconcileCalls = 0;
    const deps = baseDeps({
      poll: async () => {
        order.push('poll');
        return [];
      },
      enqueue: async () => {
        order.push('enqueue');
      },
      reconcile: async () => {
        reconcileCalls++;
        order.push('reconcile');
        return { scanned: 0, forgotten: 0 };
      },
    });

    await intakeTick(deps);

    expect(reconcileCalls).toBe(1);
    expect(order).toContain('reconcile');
    expect(order.indexOf('reconcile')).toBeGreaterThan(order.indexOf('poll'));
  });

  it('two consecutive ticks invoke reconcile once per tick (not once total, not skipped on subsequent ticks)', async () => {
    let reconcileCalls = 0;
    const deps = baseDeps({
      reconcile: async () => {
        reconcileCalls++;
      },
    });

    await intakeTick(deps);
    await intakeTick(deps);

    expect(reconcileCalls).toBe(2);
  });

  it('a reconcile() throw is caught inside the tick — the tick still returns its capture summary and never crashes the caller', async () => {
    const enqueued: unknown[] = [];
    const logLines: string[] = [];
    let reconcileCalled = false;
    const deps = baseDeps({
      poll: async () => [
        {
          id: 'o/a#1',
          source: 'github-issues',
          sourceRef: 'o/a#1',
          text: 'an idea captured this tick',
          status: 'pending' as const,
          receivedAt: '2026-07-22T00:00:00.000Z',
        },
      ],
      enqueue: async (e: unknown) => {
        enqueued.push(e);
      },
      log: (msg: string) => logLines.push(msg),
      reconcile: async () => {
        reconcileCalled = true;
        throw new Error('reconcile: gh unreachable this tick');
      },
    });

    const summary = await intakeTick(deps);

    // Prove reconcile was actually reached (and threw) — distinguishes "the
    // throw was caught" from "reconcile was never wired in at all" (today's
    // behavior, which would trivially satisfy the capture assertions below
    // without this feature existing).
    expect(reconcileCalled).toBe(true);
    // The tick's own job (capture) is unaffected by the sweep's failure.
    expect(summary.captured).toBe(1);
    expect(enqueued).toHaveLength(1);
  });
});
