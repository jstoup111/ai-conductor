/**
 * Acceptance specs for the daemon false-ship guard (ai-conductor#337,
 * .docs/stories/daemon-false-ship-guard.md Stories 3–4).
 *
 * A unit test that calls an `isVerifiedShip`-style predicate directly can
 * pass while the LIVE `makeRunFeature` done-branch still ships unconditionally
 * on any `outcome.done` — the #337 bug. This drives the REAL `makeRunFeature`
 * entry point (not the predicate in isolation) against a real tmp worktree
 * directory that already carries a `.pipeline/DONE` marker (as the gate loop
 * would leave it), and asserts the observable artifacts a false ship must
 * produce: `.pipeline/DONE` removed, `.pipeline/HALT` written with the
 * contradiction reason, zero `markProcessed`/enroll/cleanup calls, the
 * worktree kept, `escalateBuildFailure` invoked with the worktree as cwd, and
 * `maybeSweep` still run. Per-call-site unit coverage (push-evidence
 * branches, finish-predicate daemon/choice matrix) belongs to
 * test/engine/artifacts.test.ts and test/engine/daemon-runner.test.ts written
 * during /pipeline — this file only covers the cross-module done-outcome ->
 * guard -> halt/escalate flow.
 *
 * Pre-implementation: today's `makeRunFeature` ships on `outcome.done` alone,
 * so every "false ship" case below currently calls `markProcessed` and
 * removes the worktree instead of halting — RED for the right reason.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { WatchEntry, SweepOpts } from '../../src/engine/mergeable-sweep.js';

const ITEM: BacklogItem = { slug: 'feat-false-ship' };

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

interface Recorders {
  markProcessedCalls: Array<{ slug: string; prUrl?: string }>;
  teardownCalls: Array<{ keep: boolean }>;
  escalateCalls: Array<{ projectRoot: string; failureReason: string }>;
  ghCalls: string[][];
  enrollCalls: WatchEntry[];
  sweepCalls: number;
}

function freshRecorders(): Recorders {
  return {
    markProcessedCalls: [],
    teardownCalls: [],
    escalateCalls: [],
    ghCalls: [],
    enrollCalls: [],
    sweepCalls: 0,
  };
}

/**
 * Builds real FeatureRunnerDeps driving the actual worktree directory —
 * `projectRoot` is set (distinct from the worktree) so the existing
 * `outcome.prUrl && deps.projectRoot` cleanup/enroll gate is exercised
 * exactly as it is for a genuine ship, proving the false-ship guard (not an
 * incidental missing projectRoot) is what suppresses those calls.
 */
function makeDeps(
  worktreePath: string,
  projectRoot: string,
  outcome: WorktreeOutcome,
  rec: Recorders,
  escalateResult: { prUrl?: string } = { prUrl: 'https://github.com/o/r/pull/9' },
): FeatureRunnerDeps {
  const runGh: GhRunner = async (args) => {
    rec.ghCalls.push([...args]);
    return { stdout: '{}' };
  };
  return {
    createWorktree: async () => ({ path: worktreePath, branch: 'feat/false-ship' }),
    runConductor: async () => {},
    readOutcome: async () => outcome,
    teardownWorktree: async (_wt, keep) => {
      rec.teardownCalls.push({ keep });
    },
    markProcessed: async (slug, prUrl) => {
      rec.markProcessedCalls.push({ slug, prUrl });
    },
    daemon: true,
    provider: {
      invoke: async () => ({ success: true, output: '' }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
    projectRoot,
    runGh,
    enrollWatch: async (_projectRoot, entry) => {
      rec.enrollCalls.push(entry);
    },
    sweepMergeableLabels: async (_opts: SweepOpts) => {
      rec.sweepCalls += 1;
    },
    // Forward-looking injectable (Story 4 / Task 11): not yet part of
    // FeatureRunnerDeps, so today's makeRunFeature never calls it — that's
    // exactly the RED this spec pins until the failed-ship branch wires it.
    ...({
      escalateBuildFailure: async (opts: { projectRoot: string; failureReason: string }) => {
        rec.escalateCalls.push({ projectRoot: opts.projectRoot, failureReason: opts.failureReason });
        return escalateResult;
      },
    } as Partial<FeatureRunnerDeps>),
  } as FeatureRunnerDeps;
}

describe('daemon false-ship guard — real makeRunFeature entry point', () => {
  let worktreeDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), 'false-ship-wt-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'false-ship-root-'));
    await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
    // Simulate the gate loop having converged before the outcome is read.
    await writeFile(join(worktreeDir, '.pipeline', 'DONE'), 'ok\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(worktreeDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('#337 incident: done outcome with no prUrl never ships — HALT written, DONE removed, worktree kept', async () => {
    const rec = freshRecorders();
    const run = makeRunFeature(
      makeDeps(worktreeDir, projectRoot, { done: true, halted: false, finishChoice: 'pr', prUrl: undefined }, rec),
    );

    const out = await run(ITEM);

    expect(out.status).toBe('halted');
    expect(rec.markProcessedCalls).toEqual([]);
    expect(rec.teardownCalls).toEqual([{ keep: true }]);
    expect(await exists(join(worktreeDir, '.pipeline', 'DONE'))).toBe(false);
    expect(await exists(join(worktreeDir, '.pipeline', 'HALT'))).toBe(true);
    const haltText = await readFile(join(worktreeDir, '.pipeline', 'HALT'), 'utf-8');
    expect(haltText).toMatch(/done without a verified PR ship/i);
    expect(haltText).toContain('pr');
  });

  it('missing finish-choice marker with a prUrl present is still a failed ship, and skips label/enroll side effects', async () => {
    const rec = freshRecorders();
    const run = makeRunFeature(
      makeDeps(worktreeDir, projectRoot, {
        done: true,
        halted: false,
        finishChoice: undefined,
        prUrl: 'https://github.com/o/r/pull/1',
      }, rec),
    );

    const out = await run(ITEM);

    expect(out.status).toBe('halted');
    expect(rec.markProcessedCalls).toEqual([]);
    // The old code's `outcome.prUrl && deps.projectRoot` gate would otherwise
    // fire cleanup (gh calls) and enroll for this prUrl — the guard must
    // suppress them entirely, not just markProcessed.
    expect(rec.ghCalls).toEqual([]);
    expect(rec.enrollCalls).toEqual([]);
    expect(await exists(join(worktreeDir, '.pipeline', 'DONE'))).toBe(false);
    expect(await exists(join(worktreeDir, '.pipeline', 'HALT'))).toBe(true);
  });

  it('escalation surfaces the halt via a needs-remediation PR, with the worktree as cwd', async () => {
    const rec = freshRecorders();
    const run = makeRunFeature(
      makeDeps(worktreeDir, projectRoot, { done: true, halted: false, finishChoice: 'keep', prUrl: undefined }, rec),
    );

    await run(ITEM);

    expect(rec.escalateCalls).toHaveLength(1);
    expect(rec.escalateCalls[0]?.projectRoot).toBe(worktreeDir);
    expect(rec.escalateCalls[0]?.failureReason).toMatch(/keep/i);
  });

  it('FR-7 degradation: escalation push failure still halts, keeps the worktree, and writes no shipped marker', async () => {
    const rec = freshRecorders();
    const run = makeRunFeature(
      makeDeps(
        worktreeDir,
        projectRoot,
        { done: true, halted: false, finishChoice: 'merge-local', prUrl: undefined },
        rec,
        {}, // escalateBuildFailure's documented early-exit contract: {} on push failure
      ),
    );

    const out = await run(ITEM);

    expect(out.status).toBe('halted');
    expect(rec.markProcessedCalls).toEqual([]);
    expect(rec.teardownCalls).toEqual([{ keep: true }]);
    expect(await exists(join(worktreeDir, '.pipeline', 'HALT'))).toBe(true);
  });

  it('maybeSweep still runs on the failed-ship branch, matching the existing halted-outcome behavior', async () => {
    const rec = freshRecorders();
    const run = makeRunFeature(
      makeDeps(worktreeDir, projectRoot, { done: true, halted: false, finishChoice: 'discard', prUrl: undefined }, rec),
    );

    await run(ITEM);

    expect(rec.sweepCalls).toBe(1);
  });
});
