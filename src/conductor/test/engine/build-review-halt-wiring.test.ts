/**
 * Conductor-level wiring specs for Task 8
 * (build-review-grades-plan-vs-diff-against-a-stale-o): the HALT bound on a
 * SECOND stale-mirage build_review scope-FAIL detection in one
 * feature-session, and the ordering pin that disposition classification
 * (stale-mirage/genuine/halt) runs before this block's own kickback-cap HALT.
 *
 * Uses a real throwaway two-repo git fixture (same fixture as the pure-layer
 * acceptance specs, `setupStaleTrackingRefFixture`) as the Conductor's
 * `projectRoot`, with a fake StepRunner standing in for the actual
 * build_review grader dispatch (no Claude dispatch) — same pattern as
 * test/engine/merged-pr-guard-kickback.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { setupStaleTrackingRefFixture } from '../fixtures/git-repo.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { readRegradeCount } from '../../src/engine/build-review-disposition.js';

const execFile = promisify(execFileCb);

async function seedToBuildReview(statePath: string, repo: string): Promise<void> {
  const res = await readState(statePath);
  const state = (res.ok ? res.value : {}) as Record<string, unknown>;
  for (const s of ALL_STEPS) {
    if (s.name === 'build_review') break;
    state[s.name] = 'done';
  }
  state.complexity_tier = 'L';
  state.feature_desc = 'feat';
  await writeState(statePath, state as unknown as ConductState);
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(
    join(repo, '.pipeline/task-status.json'),
    JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
  );
}

describe('engine/conductor — build_review scope-FAIL disposition wiring (Task 8)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-halt-wiring-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('happy: a second stale-mirage detection this feature-session HALTs with the graded/fresh base shas, flagged paths, and regrade count', async () => {
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;

    await seedToBuildReview(statePath, repo);

    let mergeBase = fixture.staleTrackingSha;
    let flaggedPath = fixture.mergedOnlyPath;
    const calls: StepName[] = [];
    const buildReviewCallCount = { n: 0 };

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build_review') {
          buildReviewCallCount.n += 1;
          await writeFile(
            join(repo, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: [`diff touches ${flaggedPath} which is out of scope`],
              rubric: {},
            }),
          );
          return {
            success: true,
            baseFreshness: { mergeBase, trackingRefSha: null, remoteHeadSha: null, fresh: false },
          };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build_review',
    } as never);

    await conductor.run();

    // First stale-mirage detection: invalidated + regraded (build_review
    // dispatched a second time on the same run, never routed to build).
    expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    expect(buildReviewCallCount.n).toBeGreaterThanOrEqual(2);
    expect(await readRegradeCount(repo)).toBe(1);

    // A second, independent merged PR lands on the true remote, and this
    // worktree's tracking ref goes stale again — reproducing a second,
    // independent stale-mirage detection in the SAME feature-session
    // (regrade counter persists in `.pipeline/`, never reset mid-run).
    const secondMergedPath = 'merged-pr-2.txt';
    await execFile('git', ['clone', '-q', fixture.bare, join(dir, 'upstream2')]);
    const upstream2 = join(dir, 'upstream2');
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: upstream2 });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: upstream2 });
    await writeFile(join(upstream2, secondMergedPath), 'second merged PR\n');
    await execFile('git', ['add', '-A'], { cwd: upstream2 });
    await execFile('git', ['commit', '-q', '-m', 'merge PR #872'], { cwd: upstream2 });
    await execFile('git', ['push', '-q', 'origin', 'main'], { cwd: upstream2 });
    const secondFreshSha = (
      await execFile('git', ['rev-parse', 'HEAD'], { cwd: upstream2 })
    ).stdout.trim();

    const preSecondStaleRef = fixture.freshRemoteSha;
    await execFile('git', ['update-ref', 'refs/remotes/origin/main', preSecondStaleRef], {
      cwd: repo,
    });

    mergeBase = preSecondStaleRef;
    flaggedPath = secondMergedPath;

    const conductor2 = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build_review',
    } as never);

    await conductor2.run();

    const haltBody = await readFile(join(repo, HALT_MARKER), 'utf-8');
    expect(haltBody).toContain(`gradedBaseSha: ${preSecondStaleRef}`);
    expect(haltBody).toContain(`freshBaseSha: ${secondFreshSha}`);
    expect(haltBody).toContain(`flaggedPaths: ${secondMergedPath}`);
    expect(haltBody).toContain('regradeCount: 1');
  }, 30000);

  it('negative: a genuine (non-stale-mirage) build_review FAIL still routes to build rework unchanged, never HALTs on disposition', async () => {
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;

    await seedToBuildReview(statePath, repo);

    // Verdict FAILs every re-entry with genuine (non-stale) content, exactly
    // like today: never PASSes, so the run terminates at the pre-existing
    // "unresolved after N kickbacks" cap-HALT rather than proceeding past
    // build_review — this only pins that disposition classification never
    // routes a genuine FAIL into OUR scope-disposition HALT text.
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build') {
          return { success: true };
        }
        if (step === 'build_review') {
          await writeFile(
            join(repo, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              // feat.txt is the branch's OWN work — genuine out-of-scope,
              // not a stale-mirage, under any base.
              reasons: ['diff touches feat.txt which is out of scope'],
              rubric: {},
            }),
          );
          return {
            success: true,
            baseFreshness: {
              mergeBase: fixture.staleTrackingSha,
              trackingRefSha: null,
              remoteHeadSha: null,
              fresh: false,
            },
          };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build_review',
    } as never);

    await conductor.run();

    expect(calls.filter((s) => s === 'build').length).toBeGreaterThan(0);
    const haltContent = await readFile(join(repo, HALT_MARKER), 'utf-8').catch(() => null);
    expect(haltContent).not.toBeNull();
    // Whatever pre-existing HALT eventually fires (kickback cap, D2 no-op
    // re-entry, etc.), it is never OUR scope-disposition HALT (a genuine
    // FAIL is never mistaken for a second stale-mirage detection).
    expect(haltContent).not.toContain('second stale-mirage');
    expect(await readRegradeCount(repo)).toBe(0);
  }, 30000);

  it('ordering pin: a stale-mirage detection on the LAST allowed build_review kickback still invalidates+regrades — disposition classification runs before this block\'s own kickback-cap HALT', async () => {
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;

    await seedToBuildReview(statePath, repo);

    // Two genuine FAILs first (consuming both kickback slots — cap is 2), so
    // a THIRD build_review re-entry would hit this block's own
    // "unresolved after N kickbacks" cap-HALT UNLESS the stale-mirage
    // disposition on that same re-entry is classified first and short-
    // circuits into invalidate-and-regrade instead.
    let genuineFails = 0;
    let sawStaleFail = false;
    let buildCallCount = 0;
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build') {
          // Each build call resolves a new task, so the D2 no-op re-entry
          // guard (checkKickbackToBuildEscalation) never fires and doesn't
          // interfere with pinning the disposition-first ordering.
          buildCallCount += 1;
          // Seed already recorded 1 completed task — always write strictly
          // more than that AND more than the prior call, so every
          // re-entry's countResolvedTasks delta is nonzero.
          const tasks = Array.from({ length: buildCallCount + 1 }, (_, idx) => ({
            id: `task-${idx + 1}`,
            status: 'completed',
          }));
          await writeFile(
            join(repo, '.pipeline/task-status.json'),
            JSON.stringify({ tasks }),
          );
          return { success: true };
        }
        if (step === 'build_review') {
          if (genuineFails < 2) {
            genuineFails += 1;
            await writeFile(
              join(repo, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                reasons: ['diff touches feat.txt which is out of scope'],
                rubric: {},
              }),
            );
            return {
              success: true,
              baseFreshness: {
                mergeBase: fixture.staleTrackingSha,
                trackingRefSha: null,
                remoteHeadSha: null,
                fresh: false,
              },
            };
          }
          if (!sawStaleFail) {
            sawStaleFail = true;
            await writeFile(
              join(repo, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                reasons: [`diff touches ${fixture.mergedOnlyPath} which is out of scope`],
                rubric: {},
              }),
            );
            return {
              success: true,
              baseFreshness: {
                mergeBase: fixture.staleTrackingSha,
                trackingRefSha: null,
                remoteHeadSha: null,
                fresh: false,
              },
            };
          }
          // Post-regrade re-entries: back to genuine content forever (never
          // PASSes) — the run terminates via the pre-existing kickback-cap
          // HALT once the (untouched-by-the-stale-detection) kickback count
          // exceeds the cap, proving the invalidate-and-regrade path never
          // itself dead-ends into that cap.
          await writeFile(
            join(repo, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['diff touches feat.txt which is out of scope'],
              rubric: {},
            }),
          );
          return {
            success: true,
            baseFreshness: {
              mergeBase: fixture.staleTrackingSha,
              trackingRefSha: null,
              remoteHeadSha: null,
              fresh: false,
            },
          };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build_review',
    } as never);

    await conductor.run();

    // The stale-mirage re-entry (3rd build_review dispatch) never fell
    // through to the generic kickback-cap HALT — it invalidated + regraded
    // instead (regradeCount 1). The eventual cap-HALT (from post-regrade
    // genuine FAILs, untouched kickback budget) carries the pre-existing
    // cap-reason text, never our scope-disposition HALT text.
    const haltContent = await readFile(join(repo, HALT_MARKER), 'utf-8').catch(() => null);
    expect(sawStaleFail).toBe(true);
    expect(await readRegradeCount(repo)).toBe(1);
    if (haltContent !== null) {
      expect(haltContent).not.toContain('second stale-mirage');
    }
  }, 30000);
});
