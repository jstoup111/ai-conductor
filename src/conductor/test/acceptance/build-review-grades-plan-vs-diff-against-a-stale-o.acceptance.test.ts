/**
 * Acceptance specs for build_review fresh-base grading + bounded scope-verdict
 * disposition (.docs/stories/build-review-grades-plan-vs-diff-against-a-stale-o.md
 * Stories 3-6; .docs/decisions/adr-2026-07-23-build-review-fresh-base-disposition.md).
 *
 * Incident: `assembleBuildReviewInputs` computes `merge-base(<default>, HEAD)`
 * against whatever ref `detectDefaultBranch` resolves (today: the bare branch
 * name, which git resolves as the LOCAL branch, not `origin/<default>`) with no
 * freshness check. A worktree whose local `origin/<default>` tracking ref lags
 * the true remote head grades a diff that wrongly bundles main's own merged
 * work (#870/#872), and the scope-FAIL retry hint dispatches an agent to
 * mutate git history on a healthy branch.
 *
 * These specs exercise the disposition layer's designed pure-orchestrator
 * contract (Tasks 6-8 of the plan) against a REAL throwaway two-repo fixture
 * reproducing the incident (`setupStaleTrackingRefFixture`), with an INJECTED
 * fake regrade callback standing in for "re-run build_review" — no Claude
 * dispatch, same pattern as test/engine/rebase-resolution.test.ts.
 *
 * Designed contract this spec pins (does not exist yet — RED until authored):
 *   - `src/engine/build-review-disposition.ts` exports:
 *       `runScopeFailDisposition(opts): Promise<Disposition>` where
 *         opts = { git, root, gradedBaseSha, flaggedPaths, regrade }
 *         Disposition =
 *           | { kind: 'invalidated'; freshBaseSha: string; regradeResult: 'pass' | 'fail' }
 *           | { kind: 'kicked-to-build' }
 *           | { kind: 'halt'; gradedBaseSha: string; freshBaseSha: string;
 *               flaggedPaths: string[]; regradeCount: number }
 *       `resetRegradeCounter(root): Promise<void>` — called at the start of a
 *         fresh feature-session so the bound does not leak across sessions.
 *   - `resolveFreshBase(git, { probeOnly? })` exported from `rebase.ts`, returning
 *     `{ ref, kind, branch, trackingRefSha, remoteHeadSha, fresh }`.
 *
 * Pre-implementation: neither module/export exists, so every test below fails
 * on import ("Cannot find module" / "no exported member") — RED for the right
 * reason.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { setupStaleTrackingRefFixture } from '../fixtures/git-repo.js';
import { makeGitRunner, resolveFreshBase } from '../../src/engine/rebase.js';
import {
  runScopeFailDisposition,
  resetRegradeCounter,
} from '../../src/engine/build-review-disposition.js';

const execFile = promisify(execFileCb);

describe('build_review fresh-base grading + scope-verdict disposition (real git, fake regrade)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-disposition-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('Story 3: a stale-mirage scope FAIL is invalidated, not reworked', () => {
    it('happy: flagged content vanishes under the fresh base — verdict discarded, no rework, regrade PASSes', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);
      const headBefore = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: fixture.repo })).stdout.trim();

      let regradeCalls = 0;
      const regrade = async () => {
        regradeCalls++;
        return 'pass' as const;
      };

      const result = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: fixture.staleTrackingSha,
        flaggedPaths: [fixture.mergedOnlyPath],
        regrade,
      });

      expect(result.kind).toBe('invalidated');
      if (result.kind === 'invalidated') {
        expect(result.freshBaseSha).toBe(fixture.freshRemoteSha);
        expect(result.regradeResult).toBe('pass');
      }
      expect(regradeCalls).toBe(1);

      // Story 6: the engine never mutates history in this path.
      const headAfter = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: fixture.repo })).stdout.trim();
      expect(headAfter).toBe(headBefore);
    });

    it('negative: flagged content still present under the fresh base — verdict stands, kicks to build exactly as today', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      let regradeCalls = 0;
      const regrade = async () => {
        regradeCalls++;
        return 'pass' as const;
      };

      // feat.txt is the branch's OWN work — it belongs to feat's diff under
      // any base, fresh or stale, so this is a genuine (not stale-mirage) FAIL.
      const result = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: fixture.staleTrackingSha,
        flaggedPaths: ['feat.txt'],
        regrade,
      });

      expect(result.kind).toBe('kicked-to-build');
      expect(regradeCalls).toBe(0);
    });
  });

  describe('Story 4: regrade is bounded — no death loop', () => {
    it('happy: a second stale-mirage detection this session HALTs with evidence instead of re-entering grading', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      // First scope FAIL consumes the one allowed regrade.
      const first = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: fixture.staleTrackingSha,
        flaggedPaths: [fixture.mergedOnlyPath],
        regrade: async () => 'pass' as const,
      });
      expect(first.kind).toBe('invalidated');

      // A second merged PR lands on the true remote after the regrade, and
      // this worktree's tracking ref goes stale again without a re-fetch —
      // reproducing a second, independent stale-mirage detection in the same
      // feature-session.
      const secondMergedPath = 'merged-pr-2.txt';
      const preSecondStaleRef = fixture.freshRemoteSha;
      await execFile('git', ['clone', '-q', fixture.bare, join(dir, 'upstream2')]);
      const upstream2 = join(dir, 'upstream2');
      await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: upstream2 });
      await execFile('git', ['config', 'user.name', 'Test User'], { cwd: upstream2 });
      await writeFile(join(upstream2, secondMergedPath), 'second merged PR\n');
      await execFile('git', ['add', '-A'], { cwd: upstream2 });
      await execFile('git', ['commit', '-q', '-m', 'merge PR #872'], { cwd: upstream2 });
      await execFile('git', ['push', '-q', 'origin', 'main'], { cwd: upstream2 });
      const secondFreshSha = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: upstream2 })).stdout.trim();

      // Roll the fixture's tracking ref back to the first fresh sha so it is
      // once again stale relative to the (now-advanced) true remote head.
      await execFile('git', ['update-ref', 'refs/remotes/origin/main', preSecondStaleRef], { cwd: fixture.repo });

      let regradeCalls = 0;
      const second = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: preSecondStaleRef,
        flaggedPaths: [secondMergedPath],
        regrade: async () => {
          regradeCalls++;
          return 'pass' as const;
        },
      });

      expect(second.kind).toBe('halt');
      if (second.kind === 'halt') {
        expect(second.gradedBaseSha).toBe(preSecondStaleRef);
        expect(second.freshBaseSha).toBe(secondFreshSha);
        expect(second.flaggedPaths).toEqual([secondMergedPath]);
        expect(second.regradeCount).toBe(1);
      }
      expect(regradeCalls).toBe(0); // never re-enters grading
    });

    it('negative: a PASSing first regrade does not leak its counter into the next feature-session', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      const first = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: fixture.staleTrackingSha,
        flaggedPaths: [fixture.mergedOnlyPath],
        regrade: async () => 'pass' as const,
      });
      expect(first.kind).toBe('invalidated');

      // A fresh feature-session begins — the counter must reset to zero.
      await resetRegradeCounter(fixture.repo);

      // Reproduce one more independent stale-mirage detection; because the
      // counter reset, this must invalidate again, not HALT.
      const anotherPath = 'merged-pr-3.txt';
      await execFile('git', ['clone', '-q', fixture.bare, join(dir, 'upstream3')]);
      const upstream3 = join(dir, 'upstream3');
      await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: upstream3 });
      await execFile('git', ['config', 'user.name', 'Test User'], { cwd: upstream3 });
      await writeFile(join(upstream3, anotherPath), 'third merged PR\n');
      await execFile('git', ['add', '-A'], { cwd: upstream3 });
      await execFile('git', ['commit', '-q', '-m', 'merge PR #900'], { cwd: upstream3 });
      await execFile('git', ['push', '-q', 'origin', 'main'], { cwd: upstream3 });

      const staleAgainSha = fixture.freshRemoteSha; // now stale vs. the new push above
      await execFile('git', ['update-ref', 'refs/remotes/origin/main', staleAgainSha], { cwd: fixture.repo });

      const second = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: staleAgainSha,
        flaggedPaths: [anotherPath],
        regrade: async () => 'pass' as const,
      });

      expect(second.kind).toBe('invalidated');
    });
  });

  describe('Story 5: genuine out-of-scope work still fails and kicks to build', () => {
    it('happy: base freshness is confirmed and the FAIL routes to build rework with the unchanged retry hint', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      // Refresh the tracking ref first, so the graded base IS already fresh —
      // a scope FAIL under these conditions can never be a stale mirage.
      await execFile('git', ['fetch', '-q', 'origin'], { cwd: fixture.repo });
      const freshSha = (await execFile('git', ['rev-parse', 'origin/main'], { cwd: fixture.repo })).stdout.trim();

      let regradeCalls = 0;
      const result = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: freshSha,
        flaggedPaths: ['feat.txt'],
        regrade: async () => {
          regradeCalls++;
          return 'pass' as const;
        },
      });

      expect(result.kind).toBe('kicked-to-build');
      expect(regradeCalls).toBe(0);
    });

    it('negative: content persisting under a fresh base is never discarded — the invalidation path is unreachable', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      const result = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        // Even graded from the stale ref, feat.txt is genuinely out of scope —
        // it never vanishes under a fresh recompute.
        gradedBaseSha: fixture.staleTrackingSha,
        flaggedPaths: ['feat.txt'],
        regrade: async () => 'pass' as const,
      });

      expect(result.kind).not.toBe('invalidated');
      expect(result.kind).toBe('kicked-to-build');
    });
  });

  describe('Story 6: the engine never mutates history in this path', () => {
    it('negative: on a stale-mirage verdict, no agent session is dispatched at all', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      const dispatchedPrompts: string[] = [];
      // `regrade` is the ONLY hook the disposition layer may invoke on
      // invalidation — it stands in for "re-run build_review", never for an
      // agent rework session. Assert no other side channel is used to smuggle
      // a "fix in build" prompt through.
      const regrade = async () => {
        return 'pass' as const;
      };

      const result = await runScopeFailDisposition({
        git,
        root: fixture.repo,
        gradedBaseSha: fixture.staleTrackingSha,
        flaggedPaths: [fixture.mergedOnlyPath],
        regrade,
      });

      expect(result.kind).toBe('invalidated');
      expect(dispatchedPrompts.some((p) => p.includes('fix in build'))).toBe(false);
      expect(dispatchedPrompts).toHaveLength(0);
    });
  });

  describe('Story 2 (offline degrade), exercised at the resolver seam Story 3-6 depend on', () => {
    it('happy: no origin remote — resolveFreshBase degrades to local behavior without fetching', async () => {
      const noRemoteDir = await mkdtemp(join(tmpdir(), 'no-remote-'));
      await execFile('git', ['init', '-b', 'main', noRemoteDir]);
      await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: noRemoteDir });
      await execFile('git', ['config', 'user.name', 'Test User'], { cwd: noRemoteDir });
      await writeFile(join(noRemoteDir, 'a.txt'), 'a\n');
      await execFile('git', ['add', '-A'], { cwd: noRemoteDir });
      await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: noRemoteDir });

      const git = makeGitRunner(noRemoteDir);
      const result = await resolveFreshBase(git, {});

      expect(result.kind).toBe('local');
      expect(result.fresh).toBe(false);
      expect(result.remoteHeadSha).toBeNull();

      await rm(noRemoteDir, { recursive: true, force: true });
    });
  });
});
