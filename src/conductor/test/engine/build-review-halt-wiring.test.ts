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

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { setupStaleTrackingRefFixture } from '../fixtures/git-repo.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { readRegradeCount } from '../../src/engine/build-review-disposition.js';
import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  KICKBACK_LEDGER_PATH,
  MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
  readKickbackLedger,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { Conductor } from '../test-conductor.js';
import { dispatchBuildReviewRecordReducedCoverage } from '../../src/engine/build-review-cli.js';

const execFile = promisify(execFileCb);

function withPassingBuildVerification(repo: string, runner: StepRunner): StepRunner {
  return {
    ...runner,
    run: async (step, state, opts) => {
      if (step === 'wiring_check') {
        const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repo });
        await writeFile(
          join(repo, '.pipeline/wiring-evidence.json'),
          JSON.stringify({
            schema: 1,
            base: 'fixture-base',
            head: stdout.trim(),
            layer2: { applicable: false },
            waivers: [],
            tasks: [{ id: 'fixture', contract: 'none (fixture)', gaps: [] }],
          }),
        );
        return { success: true };
      }
      return runner.run(step, state, opts);
    },
  };
}

async function seedToBuildReview(
  statePath: string,
  repo: string,
  opts?: { markRemainingStepsDone?: boolean },
): Promise<void> {
  const res = await readState(statePath);
  const state = (res.ok ? res.value : {}) as Record<string, unknown>;
  let seenBuildReview = false;
  for (const s of ALL_STEPS) {
    if (s.name === 'build_review') {
      seenBuildReview = true;
      continue;
    }
    if (!seenBuildReview) {
      state[s.name] = 'done';
    } else if (opts?.markRemainingStepsDone) {
      // Pre-mark every step after build_review as already-done, so a run
      // scoped to exercising ONLY build_review's own outcome terminates
      // cleanly once build_review succeeds, instead of continuing on into
      // unrelated later-step gates (which are out of scope here and would
      // otherwise HALT on their own unmet completion criteria).
      state[s.name] = 'done';
    }
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
              findings: { scope: [`diff touches ${flaggedPath} which is out of scope`] },
              rubric: { tautology: false, scope: true, rootCause: false, completeness: false, wiring: false },
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
      stepRunner: withPassingBuildVerification(repo, runner),
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
      stepRunner: withPassingBuildVerification(repo, runner),
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
    // A second stale-mirage scope-FAIL disposition never re-enters grading —
    // only an operator can resolve it, so the HALT is classified needs-human.
    const haltClass = await readFile(join(repo, '.pipeline/HALT.class'), 'utf-8');
    expect(haltClass).toBe('needs-human');
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
              findings: { scope: ['diff touches feat.txt which is out of scope'] },
              rubric: { tautology: false, scope: true, rootCause: false, completeness: false, wiring: false },
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
      stepRunner: withPassingBuildVerification(repo, runner),
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

    // Seed an already-exhausted budget directly. This isolates the ordering
    // contract from build-fixture progress mechanics: the first FAIL below
    // must still run stale-mirage disposition before its own cap HALT.
    const seeded = await readState(statePath);
    const seededState = (seeded.ok ? seeded.value : {}) as ConductState;
    seededState.run_started_at = Date.now();
    await writeState(statePath, seededState);
    await mkdir(join(repo, '.pipeline'), { recursive: true });
    await writeFile(join(repo, KICKBACK_LEDGER_PATH), JSON.stringify({
      version: 1,
      gates: {
        build_review: {
          count: 2,
          treeHash: null,
          lastReason: 'prior genuine failure',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    }));
    expect((await readKickbackLedger(repo)).gates.build_review?.cumulative).toBe(0);

    let genuineFails = 2;
    let sawStaleFail = false;
    let buildCallCount = 0;
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build') {
          // This branch must remain unreachable: stale-mirage disposition
          // regrades build_review directly rather than dispatching rework.
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
                findings: { scope: ['diff touches feat.txt which is out of scope'] },
                rubric: { tautology: false, scope: true, rootCause: false, completeness: false, wiring: false },
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
                findings: { scope: [`diff touches ${fixture.mergedOnlyPath} which is out of scope`] },
                rubric: { tautology: false, scope: true, rootCause: false, completeness: false, wiring: false },
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
              findings: { scope: ['diff touches feat.txt which is out of scope'] },
              rubric: { tautology: false, scope: true, rootCause: false, completeness: false, wiring: false },
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
      stepRunner: withPassingBuildVerification(repo, runner),
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

  it('Task 9 (a): a stale-mirage scope FAIL never dispatches rework — it is invalidated, the verdict artifact is removed, and the regrade PASSes', async () => {
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;

    await seedToBuildReview(statePath, repo, { markRemainingStepsDone: true });

    const calls: StepName[] = [];
    const buildReviewCallCount = { n: 0 };
    // On the second build_review dispatch (the regrade the disposition layer
    // triggers on `invalidated`), the conductor must have already removed the
    // stale FAIL verdict artifact (`removeBuildReviewVerdict`) BEFORE
    // re-entering — asserted here by checking the file is absent the moment
    // this fake runner is re-invoked, before it writes anything itself.
    let verdictAbsentOnRegradeEntry: boolean | null = null;

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build_review') {
          buildReviewCallCount.n += 1;
          if (buildReviewCallCount.n === 1) {
            await writeFile(
              join(repo, '.pipeline/build-review.json'),
              JSON.stringify({
                verdict: 'FAIL',
                reasons: [`diff touches ${fixture.mergedOnlyPath} which is out of scope`],
                findings: { scope: [`diff touches ${fixture.mergedOnlyPath} which is out of scope`] },
                rubric: { tautology: false, scope: true, rootCause: false, completeness: false, wiring: false },
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
          // Regrade re-entry.
          verdictAbsentOnRegradeEntry = await readFile(
            join(repo, '.pipeline/build-review.json'),
            'utf-8',
          )
            .then(() => false)
            .catch(() => true);
          await writeFile(
            join(repo, '.pipeline/build-review.json'),
            JSON.stringify({ verdict: 'PASS', reasons: [], rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false } }),
          );
          return {
            success: true,
            baseFreshness: {
              mergeBase: fixture.freshRemoteSha,
              trackingRefSha: fixture.freshRemoteSha,
              remoteHeadSha: fixture.freshRemoteSha,
              fresh: true,
            },
          };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: withPassingBuildVerification(repo, runner),
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build_review',
    } as never);

    await conductor.run();

    // No rework dispatch: the invalidated path never routes to `build`.
    expect(calls.filter((s) => s === 'build')).toHaveLength(0);
    // A regrade occurred: build_review was re-entered exactly once.
    expect(buildReviewCallCount.n).toBe(2);
    expect(await readRegradeCount(repo)).toBe(1);
    // The stale FAIL verdict was removed before the regrade re-entry wrote
    // its own (fresh) verdict.
    expect(verdictAbsentOnRegradeEntry).toBe(true);
    // The regrade PASSed: final verdict artifact reflects PASS, not the
    // discarded stale FAIL.
    const finalVerdict = JSON.parse(
      await readFile(join(repo, '.pipeline/build-review.json'), 'utf-8'),
    );
    expect(finalVerdict.verdict).toBe('PASS');
    // No disposition HALT fired for this (single) stale-mirage detection.
    const haltContent = await readFile(join(repo, HALT_MARKER), 'utf-8').catch(() => null);
    if (haltContent !== null) {
      expect(haltContent).not.toContain('second stale-mirage');
    }
  }, 30000);

  it('Task 9 (d): offline degrade — a repo with no origin remote still completes a build_review grading pass on the local branch, never HALTing or throwing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-halt-wiring-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();

    // A plain, remote-less repo — no `origin` configured at all.
    const repo = join(dir, 'no-remote-repo');
    await mkdir(repo, { recursive: true });
    await execFile('git', ['init', '-q', '-b', 'main', repo]);
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await execFile('git', ['add', '-A'], { cwd: repo });
    await execFile('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
    await writeFile(join(repo, 'feat.txt'), 'feature work\n');
    await execFile('git', ['add', '-A'], { cwd: repo });
    await execFile('git', ['commit', '-q', '-m', 'feature work'], { cwd: repo });

    await mkdir(join(repo, '.docs/plans'), { recursive: true });
    await writeFile(join(repo, '.docs/plans/feat.md'), '# Implementation Plan: feat\n\nDo the thing.\n');
    // build_review runs inside BUILD, so its protected DECIDE input must be
    // committed before the conductor establishes the immutable seal.
    await execFile('git', ['add', '.docs/plans/feat.md'], { cwd: repo });
    await execFile('git', ['commit', '-q', '-m', 'docs: approve implementation plan'], { cwd: repo });

    await seedToBuildReview(statePath, repo, { markRemainingStepsDone: true });

    const calls: StepName[] = [];
    let proofInspections = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'build_review') {
          // Exercises the REAL production fail-soft resolver
          // (assembleBuildReviewInputs -> resolveFreshBase) against a repo
          // with no origin remote: it must degrade to the local branch
          // without throwing, rather than the fake-verdict shortcut the
          // other specs in this file use.
          const inputs = await assembleBuildReviewInputs(
            makeGitRunner(repo),
            join(repo, '.docs/plans/feat.md'),
            {
              inspectTestSuite: async () => {
                proofInspections += 1;
                return {
                  status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
                } as never;
              },
            },
          );
          expect(inputs.baseKind).toBe('local');
          expect(inputs.fresh).toBe(false);
          expect(inputs.remoteHeadSha).toBeNull();
          expect(inputs.testSuiteProof).toMatchObject({ provenanceHeadSha: 'fixture-head', outcome: 'PASS' });

          await writeFile(
            join(repo, '.pipeline/build-review.json'),
            JSON.stringify({ verdict: 'PASS', reasons: [], rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false } }),
          );
          return {
            success: true,
            baseFreshness: {
              mergeBase: inputs.mergeBase,
              trackingRefSha: inputs.trackingRefSha,
              remoteHeadSha: inputs.remoteHeadSha,
              fresh: inputs.fresh,
            },
          };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: withPassingBuildVerification(repo, runner),
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build_review',
    } as never);

    await conductor.run();

    expect(calls.filter((s) => s === 'build_review').length).toBeGreaterThanOrEqual(1);
    expect(proofInspections).toBeGreaterThanOrEqual(1);
    const finalVerdict = JSON.parse(
      await readFile(join(repo, '.pipeline/build-review.json'), 'utf-8'),
    );
    expect(finalVerdict.verdict).toBe('PASS');
    const haltContent = await readFile(join(repo, HALT_MARKER), 'utf-8').catch(() => null);
    expect(haltContent).toBeNull();
  }, 30000);

  it.each(['missing', 'unreadable'] as const)('build_review PASS does not turn a %s ledger reset into a gate failure', async (ledgerState) => {
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;
    await seedToBuildReview(statePath, repo, { markRemainingStepsDone: true });
    const ledgerPath = join(repo, '.pipeline/kickback-ledger.json');
    if (ledgerState === 'unreadable') await mkdir(ledgerPath, { recursive: true });

    const calls: StepName[] = [];
    const runner: StepRunner = { run: async (step) => {
      calls.push(step);
      if (step === 'build_review') {
        await writeFile(join(repo, '.pipeline/build-review.json'), JSON.stringify({
          verdict: 'PASS', reasons: [], rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: false },
        }));
      }
      return { success: true };
    } };

    await new Conductor({
      stateFilePath: statePath, stepRunner: withPassingBuildVerification(repo, runner), events,
      projectRoot: repo, mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1,
      fromStep: 'build_review',
    } as never).run();

    expect(calls).toContain('build_review');
    expect(await readFile(join(repo, HALT_MARKER), 'utf8').catch(() => null)).toBeNull();
    if (ledgerState === 'missing') {
      await expect(readFile(ledgerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }, 30000);

  it('carries the cumulative-cap reason on the emitted loop_halt and the operator halt marker', async () => {
    const state: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'build_review') break;
      state[step.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'cumulative-cap-event-ledger';
    state.run_started_at = Date.now();
    await writeState(statePath, state as ConductState);
    await writeKickbackLedger(dir, { version: 1, gates: { build_review: {
      count: 1, cumulative: 5, treeHash: 'previous-tree', lastReason: 'tautology: stale assertion', priorVerdict: true, resolvedBefore: 0,
    } } });
    // Asserted on the emitter and the halt marker, NOT on .pipeline/events.jsonl:
    // `loop_halt` is declared persist:false, and flipping that declaration is
    // Task 1 of the loop-halt-never-reaches-events-jsonl feature (ADR
    // adr-2026-08-11-halt-events-ride-the-persisted-spine). This feature owns
    // the reason text, not the sink policy.
    const haltReasons: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt' && typeof event.reason === 'string') haltReasons.push(event.reason);
    });
    const runner: StepRunner = { run: async (step) => {
      if (step === 'build_review') await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
        verdict: 'FAIL', reasons: ['tautology: stale assertion'], findings: { tautology: ['stale assertion'] },
        rubric: { tautology: true, scope: false, rootCause: false, completeness: false, wiring: false },
      }));
      return { success: true };
    } };
    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: dir,
      mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1, fromStep: 'build_review',
      config: { build_review: { enabled: true } },
    }).run();

    const expectedReason =
      'build_review cumulative kickback cap exceeded (cumulative 6, cap 5): tautology: stale assertion\n[tautology] stale assertion';
    expect(haltReasons).toContain(expectedReason);
    expect(await readFile(join(dir, '.pipeline/HALT'), 'utf8')).toContain(expectedReason);
  }, 30000);

  it('accepts a retired four-rubric result without the wiring member', async () => {
    const validVerdict = {
      verdict: 'PASS', reasons: [],
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    };
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;
    await seedToBuildReview(statePath, repo, { markRemainingStepsDone: true });
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        calls.push(step);
        if (step === 'build_review') {
          await writeFile(join(repo, '.pipeline/build-review.json'), JSON.stringify(validVerdict));
        }
        return { success: true };
      },
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: withPassingBuildVerification(repo, runner), events,
      projectRoot: repo, mode: 'auto', daemon: true, verifyArtifacts: true, maxRetries: 1,
      fromStep: 'build_review',
    } as never).run();

    expect(calls.filter((step) => step === 'build_review')).toHaveLength(1);
    expect(calls).not.toContain('wiring_check');
    expect(await readFile(join(repo, HALT_MARKER), 'utf8').catch(() => null)).toBeNull();
  }, 30000);

  it('halts for a human after an exhausted mechanical allowance publishes its aggregate instead of retrying', async () => {
    const fixture = await setupStaleTrackingRefFixture(dir);
    const repo = fixture.repo;
    await seedToBuildReview(statePath, repo);
    const seeded = await readState(statePath);
    await writeState(statePath, {
      ...(seeded.ok ? seeded.value : {}),
      run_started_at: Date.now(),
    } as ConductState);
    await writeKickbackLedger(repo, {
      version: 1,
      gates: {
        build_review: {
          count: 0, cumulative: 0,
          mechanicalFaults: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
          treeHash: null, lastReason: '', priorVerdict: true, resolvedBefore: 0,
        },
      },
    });

    const calls: StepName[] = [];
    const allowanceOccurrences: unknown[] = [];
    events.on('build_review_mechanical_allowance_exhausted' as never, (event) => {
      allowanceOccurrences.push(event);
    });
    const lapId = parseBuildReviewLapId('lap-mechanical-root-cause')!;
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest: 'sha256:mechanical-halt',
      results: {
        tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:mechanical-halt', contractVersion: 'v3', findings: [], verdict: 'PASS' },
        scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:mechanical-halt', contractVersion: 'v3', findings: [], verdict: 'PASS' },
        rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'provider transport unavailable' },
        completeness: { kind: 'judged', rubric: 'completeness', lapId, snapshotDigest: 'sha256:mechanical-halt', contractVersion: 'v3', findings: [], verdict: 'PASS' },
      },
    });
    const runner: StepRunner = {
      run: async (step) => {
        calls.push(step);
        if (step === 'build_review') {
          await writeFile(
            join(repo, '.pipeline/build-review.json'),
            JSON.stringify(aggregate),
          );
          return { success: false, output: 'scope rubric infrastructure failure' };
        }
        return { success: true };
      },
    };

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: withPassingBuildVerification(repo, runner),
      events,
      projectRoot: repo,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 2,
      fromStep: 'build_review',
    } as never).run();

    expect(calls.filter((step) => step === 'build_review')).toHaveLength(1);
    const haltBody = await readFile(join(repo, HALT_MARKER), 'utf8');
    expect(haltBody).toMatch(
      /build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed\.\nCurrent lap lap-mechanical-root-cause: rootCause closed cause provider-error \(provider transport unavailable\)\.\n1\. Record a reduced-coverage decision: conduct-ts build-review record-reduced-coverage --feature <feature-slug> --lap lap-mechanical-root-cause --rubric rootCause --rationale "<rationale>"\.\n2\. Clear the documented terminal state: rm -f \.pipeline\/HALT \.pipeline\/HALT\.class\./,
    );
    expect(haltBody).not.toContain('cannot converge');
    expect(await readFile(join(repo, '.pipeline/HALT.class'), 'utf8')).toBe('needs-human');
    expect(allowanceOccurrences).toEqual([expect.objectContaining({
      type: 'build_review_mechanical_allowance_exhausted',
      lapId,
      rubric: 'rootCause',
      reason: 'provider-error',
      consumed: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
      allowance: MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
    })]);
  }, 30000);

  it('writes reduced-coverage CLI outcomes through the external same-schema writer', async () => {
    const lapId = parseBuildReviewLapId('lap-event-spine')!;
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest: 'sha256:event-spine',
      results: {
        tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:event-spine', contractVersion: 'v3', findings: [], verdict: 'PASS' },
        scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:event-spine', contractVersion: 'v3', findings: [], verdict: 'PASS' },
        rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'offline' },
        completeness: { kind: 'judged', rubric: 'completeness', lapId, snapshotDigest: 'sha256:event-spine', contractVersion: 'v3', findings: [], verdict: 'PASS' },
      },
    });
    const externalOccurrences: unknown[] = [];
    const command = {
      kind: 'record-reduced-coverage' as const,
      feature: 'event-spine',
      lapId,
      rubric: 'rootCause',
      rationale: 'The provider remains unavailable.',
    };
    const commonDeps = {
      cwd: dir,
      resolveMainRoot: async () => dir,
      realpath: async (path: string) => path,
      isInteractive: true,
      resolveOperator: () => 'local-operator',
      readFile: async () => JSON.stringify(aggregate),
      readMechanicalFaults: async () => MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
      createStore: () => ({
        appendReducedCoverageIfCurrent: async (_input: unknown, validate: (records: readonly unknown[]) => Promise<boolean>) => {
          await validate([]);
          return { ok: true as const, record: {} };
        },
      }),
      appendEvent: (_worktree: string, event: unknown) => externalOccurrences.push(event),
      print: () => {},
    };
    await expect(dispatchBuildReviewRecordReducedCoverage(command, commonDeps as never)).resolves.toBe(0);
    await expect(dispatchBuildReviewRecordReducedCoverage(command, {
      ...commonDeps,
      isInteractive: false,
    } as never)).resolves.toBe(1);

    expect(externalOccurrences).toEqual([
      expect.objectContaining({
        type: 'build_review_reduced_coverage_accepted', feature: 'event-spine', lapId,
        rubric: 'rootCause', reason: 'provider-error', operator: 'local-operator',
      }),
      expect.objectContaining({
        type: 'build_review_disposition_refused', feature: 'event-spine',
        reason: 'non-interactive-or-unidentified-operator',
      }),
    ]);
  }, 30000);
});
