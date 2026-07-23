import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  assembleBuildReviewInputs,
  MergeBaseError,
} from '../../src/engine/build-review-inputs.js';
import { makeGitRunner, type GitRunner, type GitResult } from '../../src/engine/rebase.js';
import { setupStaleTrackingRefFixture } from '../fixtures/git-repo.js';

// A scripted GitRunner: matches argv prefixes to canned results (same pattern
// as test/engine/rebase.test.ts's fakeGit).
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

const execFileAsync = promisify(execFile);

describe('engine/build-review-inputs — assembleBuildReviewInputs', () => {
  describe('unit (scripted GitRunner)', () => {
    let planPath: string;
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-inputs-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan body\n\nSome plan content.\n', 'utf-8');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    // resolveFreshBase's happy-path probe sequence: remote → symbolic-ref →
    // rev-parse tracking ref → ls-remote (fresh when shas match).
    const freshProbeScript = [
      { match: ['remote'], result: { exitCode: 0, stdout: 'origin\n' } },
      { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 0, stdout: 'refs/remotes/origin/main\n' } },
      { match: ['rev-parse', 'refs/remotes/origin/main'], result: { exitCode: 0, stdout: 'abc1234\n' } },
      { match: ['ls-remote', 'origin', 'main'], result: { exitCode: 0, stdout: 'abc1234\trefs/heads/main\n' } },
    ];

    it('merge-base failure raises a typed MergeBaseError', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 1, stderr: 'fatal: no merge base' } },
      ]);

      await expect(assembleBuildReviewInputs(git, planPath)).rejects.toBeInstanceOf(
        MergeBaseError,
      );
    });

    it('empty diff signals no-diff (empty diff string returned)', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { exitCode: 0, stdout: '' } },
      ]);

      const result = await assembleBuildReviewInputs(git, planPath);
      expect(result.diff).toBe('');
      expect(result.planBody).toContain('Plan body');
    });

    it('fresh base: returns base evidence with fresh=true and no fetch performed', async () => {
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/x b/x\n' } },
      ]);

      const result = await assembleBuildReviewInputs(git, planPath);
      expect(result.baseRef).toBe('origin/main');
      expect(result.baseKind).toBe('remote');
      expect(result.fresh).toBe(true);
      expect(result.trackingRefSha).toBe('abc1234');
      expect(result.remoteHeadSha).toBe('abc1234');
      expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
    });

    it('stale base: fetches, recomputes merge-base against the refreshed ref, fresh=false', async () => {
      const { git } = fakeGit([
        { match: ['remote'], result: { exitCode: 0, stdout: 'origin\n' } },
        { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 0, stdout: 'refs/remotes/origin/main\n' } },
        { match: ['rev-parse', 'refs/remotes/origin/main'], result: { exitCode: 0, stdout: 'stale111\n' } },
        { match: ['ls-remote', 'origin', 'main'], result: { exitCode: 0, stdout: 'fresh222\trefs/heads/main\n' } },
        // resolveBaseCore's fetch path (stale → refetch):
        { match: ['fetch', 'origin', 'main'], result: { exitCode: 0 } },
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'newbase\n' } },
        { match: ['diff', 'newbase..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/y b/y\n' } },
      ]);

      const result = await assembleBuildReviewInputs(git, planPath);
      expect(result.baseRef).toBe('origin/main');
      expect(result.baseKind).toBe('remote');
      expect(result.fresh).toBe(false);
      expect(result.trackingRefSha).toBe('stale111');
      expect(result.remoteHeadSha).toBe('fresh222');
      expect(result.diff).toContain('diff --git a/y b/y');
    });

    it('no-remote fallback: keeps local behavior, emits one advisory console.warn', async () => {
      const { git } = fakeGit([
        { match: ['remote'], result: { exitCode: 0, stdout: '' } },
        { match: ['symbolic-ref', '--short', 'HEAD'], result: { exitCode: 0, stdout: 'feature/foo\n' } },
        { match: ['merge-base', 'feature/foo', 'HEAD'], result: { exitCode: 0, stdout: 'localbase\n' } },
        { match: ['diff', 'localbase..HEAD'], result: { exitCode: 0, stdout: '' } },
      ]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = await assembleBuildReviewInputs(git, planPath);
        expect(result.baseRef).toBe('feature/foo');
        expect(result.baseKind).toBe('local');
        expect(result.fresh).toBe(false);
        expect(result.trackingRefSha).toBeNull();
        expect(result.remoteHeadSha).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('build_review');
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('fixture repo (real git, merge-base correctness)', () => {
    let dir: string;
    let planPath: string;

    async function git(...args: string[]): Promise<string> {
      const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
      return stdout.trim();
    }

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-fixture-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan body\n\nFixture plan.\n', 'utf-8');

      await execFileAsync('git', ['init', '-b', 'main', dir]);
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');

      // Simulate an origin whose default branch is 'main'. Register a real
      // `origin` remote pointed at this same repo (local-path "clone") so
      // `resolveFreshBase`'s `git remote` / `ls-remote origin` probe has a
      // real remote to talk to, then set refs/remotes/origin/HEAD to point
      // at refs/heads/main so default-branch discovery resolves it.
      await writeFile(join(dir, 'base.txt'), 'base\n');
      await git('add', '.');
      await git('commit', '-m', 'initial commit on base');
      await git('remote', 'add', 'origin', dir);
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
      await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

      await git('checkout', '-b', 'feature/foo');
      await writeFile(join(dir, 'feature.txt'), 'feature change\n');
      await git('add', '.');
      await git('commit', '-m', 'add feature change');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    function realGit(): GitRunner {
      return async (args: string[]) => {
        try {
          const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
          return { exitCode: 0, stdout, stderr };
        } catch (err) {
          const e = err as { code?: number; stdout?: string; stderr?: string };
          return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
        }
      };
    }

    it('computes the merge-base against the discovered default branch and returns the diff since it', async () => {
      const result = await assembleBuildReviewInputs(realGit(), planPath);
      expect(result.diff).toContain('feature.txt');
      expect(result.diff).toContain('feature change');
      expect(result.planBody).toContain('Fixture plan.');
    });
  });

  // Regression fixture for the stale-tracking-ref incident (#870/#872): a
  // bare "remote" advances past the clone's local `origin/main` tracking
  // ref (merged-PR content lands after the clone last synced), the clone's
  // `feat` branch is rebased onto the TRUE remote head (a healthy rebase),
  // and then the clone's tracking ref is rolled back to simulate a worktree
  // that never re-fetched. Pre-Task-3, `assembleBuildReviewInputs` computed
  // its merge-base against the stale local `origin/main`, which would
  // wrongly bundle the merged-PR-only content into the graded diff. Post-
  // Task-3 (`resolveFreshBase`), the base resolution detects the mismatch,
  // fetches, and grades only the branch's own commits.
  describe('real two-repo fixture (setupStaleTrackingRefFixture)', () => {
    let dir: string;
    let planPath: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-stale-ref-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan body\n\nStale-ref regression fixture.\n', 'utf-8');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('grades only the feat branch commits, not merged-PR-only content that arrived after the tracking ref went stale', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      const result = await assembleBuildReviewInputs(git, planPath);

      expect(result.diff).not.toContain(fixture.mergedOnlyPath);
      expect(result.diff).toContain('feat.txt');
      expect(result.diff).toContain('feature work');

      // A stale-ref mismatch was detected and resolved: the tracking ref at
      // resolution time differed from the true remote head, so the base
      // ended up fresh (post-fetch) rather than silently graded stale.
      expect(result.trackingRefSha).toBe(fixture.staleTrackingSha);
      expect(result.remoteHeadSha).toBe(fixture.freshRemoteSha);
      expect(result.trackingRefSha).not.toBe(result.remoteHeadSha);
      expect(result.baseKind).toBe('remote');
      // `fresh` means "tracking ref already matched the remote head, no
      // fetch needed" — here the mismatch was detected and a fetch was
      // required, so `fresh` is correctly `false` per the documented
      // semantics on `BuildReviewInputs.fresh`.
      expect(result.fresh).toBe(false);
    });
  });
});
