/**
 * `mergeable_skip` policy.
 *
 * A textually-clean `git merge-tree` says the branch and the base do not
 * collide. It says NOTHING about whether the branch's gates — build_review,
 * test_suite, manual_test — were graded against the base that is actually going
 * to be merged into. On the `unattended-finish-spends-minutes-before-determinis`
 * run, build_review graded at base `c6839018bf47` while `origin/main` moved
 * ahead with real code, the text still merged cleanly, and the rebase was
 * skipped — shipping a feature validated against a base that no longer exists.
 *
 * Two rules, both deterministic:
 *   1. A base that advanced with code/test changes since the branch's
 *      merge-base is not skippable on textual cleanliness alone.
 *   2. A skip decision is never taken on a DEGRADED base — a `local` fallback
 *      chosen because origin discovery or `git fetch` failed, where local
 *      `main` in a daemon worktree can be arbitrarily far behind origin.
 *
 * A genuinely remote-less repository keeps the skip: its local base is not
 * stale, it IS the truth. And the `noop` path (already current) is untouched.
 *
 * Scripted git runner only — no real repo, no remote, no network.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { performRebase, type GitRunner, type GitResult } from '../../src/engine/rebase.js';

const MERGE_BASE = 'c6839018bf47c0de0000000000000000deadbeef';
const BASE_SHA = 'aa11bb22cc33dd44ee55ff660000000000000000';

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
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

/**
 * Common preamble: in a work tree, no pre-existing conflicts, origin exists and
 * `origin/main` is discovered + fetched, the branch is behind, and the
 * prospective merge is textually CLEAN.
 */
function cleanlyMergeableAgainstOrigin(
  baseDelta: string,
  overrides: Array<{ match: string[]; result: Partial<GitResult> }> = [],
): { git: GitRunner; calls: string[][] } {
  return fakeGit([
    ...overrides,
    { match: ['rev-parse', '--is-inside-work-tree'], result: { stdout: 'true\n' } },
    { match: ['diff', '--name-only', '--diff-filter=U'], result: {} },
    { match: ['remote'], result: { stdout: 'origin\n' } },
    {
      match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      result: { stdout: 'refs/remotes/origin/main\n' },
    },
    { match: ['fetch', 'origin', 'main'], result: { exitCode: 0 } },
    { match: ['rev-list', '--count', 'HEAD..origin/main'], result: { stdout: '3\n' } },
    {
      match: ['merge-tree', '--write-tree', '--quiet', 'origin/main', 'HEAD'],
      result: { exitCode: 0 },
    },
    { match: ['merge-base', 'HEAD', 'origin/main'], result: { stdout: `${MERGE_BASE}\n` } },
    { match: ['rev-parse', 'origin/main'], result: { stdout: `${BASE_SHA}\n` } },
    { match: ['diff', '--name-only', MERGE_BASE, 'origin/main'], result: { stdout: baseDelta } },
    { match: ['rebase'], result: { exitCode: 0 } },
  ]);
}

describe('engine/rebase — mergeable_skip policy', () => {
  let root: string;

  async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
    root = await mkdtemp(join(tmpdir(), 'rebase-skip-policy-'));
    try {
      await fn(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('does NOT skip when the base advanced with code changes since the merge-base', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = cleanlyMergeableAgainstOrigin(
        'src/engine/conductor.ts\ndocs/reference/steps.md\n',
      );

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome.kind).not.toBe('mergeable_skip');
      expect(calls.some((args) => args[0] === 'rebase')).toBe(true);
    });
  });

  it('DOES skip when the base advanced only in documentation', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = cleanlyMergeableAgainstOrigin('docs/reference/steps.md\nREADME.md\n');

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome).toEqual({
        kind: 'mergeable_skip',
        baseRef: 'origin/main',
        baseSha: BASE_SHA,
        baseKind: 'remote',
      });
      expect(calls.some((args) => args[0] === 'rebase')).toBe(false);
    });
  });

  it('does NOT skip on a DEGRADED local base — origin exists but the fetch failed', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = fakeGit([
        { match: ['rev-parse', '--is-inside-work-tree'], result: { stdout: 'true\n' } },
        { match: ['diff', '--name-only', '--diff-filter=U'], result: {} },
        { match: ['remote'], result: { stdout: 'origin\n' } },
        {
          match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
          result: { stdout: 'refs/remotes/origin/main\n' },
        },
        // The degrade: fetch fails, so resolveBase falls back to LOCAL main,
        // which in a daemon worktree can be arbitrarily far behind origin.
        { match: ['fetch', 'origin', 'main'], result: { exitCode: 128 } },
        { match: ['rev-list', '--count', 'HEAD..main'], result: { stdout: '1\n' } },
        {
          match: ['merge-tree', '--write-tree', '--quiet', 'main', 'HEAD'],
          result: { exitCode: 0 },
        },
        { match: ['merge-base', 'HEAD', 'main'], result: { stdout: `${MERGE_BASE}\n` } },
        // Even a docs-only delta must not buy a skip here: the comparison ref
        // itself is untrustworthy.
        { match: ['diff', '--name-only', MERGE_BASE, 'main'], result: { stdout: 'docs/x.md\n' } },
        { match: ['rebase'], result: { exitCode: 0 } },
      ]);

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome.kind).not.toBe('mergeable_skip');
      expect(calls.some((args) => args[0] === 'rebase')).toBe(true);
    });
  });

  it('still skips in a repository with NO origin remote — its local base is authoritative, not degraded', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = fakeGit([
        { match: ['rev-parse', '--is-inside-work-tree'], result: { stdout: 'true\n' } },
        { match: ['diff', '--name-only', '--diff-filter=U'], result: {} },
        { match: ['remote'], result: { stdout: '' } },
        { match: ['rev-list', '--count', 'HEAD..main'], result: { stdout: '1\n' } },
        {
          match: ['merge-tree', '--write-tree', '--quiet', 'main', 'HEAD'],
          result: { exitCode: 0 },
        },
        { match: ['merge-base', 'HEAD', 'main'], result: { stdout: `${MERGE_BASE}\n` } },
        { match: ['rev-parse', 'main'], result: { stdout: `${BASE_SHA}\n` } },
        { match: ['diff', '--name-only', MERGE_BASE, 'main'], result: { stdout: 'docs/x.md\n' } },
      ]);

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome).toEqual({
        kind: 'mergeable_skip',
        baseRef: 'main',
        baseSha: BASE_SHA,
        baseKind: 'local',
      });
      expect(calls.some((args) => args[0] === 'rebase')).toBe(false);
    });
  });

  it('fails closed: an uncomputable base delta is not skippable', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = cleanlyMergeableAgainstOrigin('', [
        // No merge-base resolvable → the "what moved on the base" question
        // cannot be answered, so the skip cannot be justified.
        { match: ['merge-base', 'HEAD', 'origin/main'], result: { exitCode: 1, stdout: '' } },
      ]);

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome.kind).not.toBe('mergeable_skip');
      expect(calls.some((args) => args[0] === 'rebase')).toBe(true);
    });
  });
});
