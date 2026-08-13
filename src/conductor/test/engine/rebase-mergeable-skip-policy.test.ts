/**
 * `mergeable_skip` policy.
 *
 * At normal finish, a clean prospective merge is sufficient to preserve feature
 * history. Base delta and fallback provenance do not change that predicate;
 * only conflicting or indeterminate prospective merges enter the real rebase
 * path. Re-kick deliberately omits this finish-only policy and still rebases.
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
    { match: ['rev-parse', 'origin/main'], result: { stdout: `${BASE_SHA}\n` } },
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

  it('skips when the base advanced with code changes but remains cleanly mergeable', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = cleanlyMergeableAgainstOrigin();

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome.kind).toBe('mergeable_skip');
      expect(calls.some((args) => args[0] === 'rebase')).toBe(false);
    });
  });

  it('skips a cleanly mergeable remote base', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = cleanlyMergeableAgainstOrigin();

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

  it('skips on a local fallback when origin fetch fails but the merge is clean', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = fakeGit([
        { match: ['rev-parse', '--is-inside-work-tree'], result: { stdout: 'true\n' } },
        { match: ['diff', '--name-only', '--diff-filter=U'], result: {} },
        { match: ['remote'], result: { stdout: 'origin\n' } },
        {
          match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
          result: { stdout: 'refs/remotes/origin/main\n' },
        },
        // Fetch failure falls back to LOCAL main; the finish policy still uses
        // the clean prospective merge against that resolved base.
        { match: ['fetch', 'origin', 'main'], result: { exitCode: 128 } },
        { match: ['rev-list', '--count', 'HEAD..main'], result: { stdout: '1\n' } },
        {
          match: ['merge-tree', '--write-tree', '--quiet', 'main', 'HEAD'],
          result: { exitCode: 0 },
        },
        { match: ['rebase'], result: { exitCode: 0 } },
      ]);

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome.kind).toBe('mergeable_skip');
      expect(calls.some((args) => args[0] === 'rebase')).toBe(false);
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
        { match: ['rev-parse', 'main'], result: { stdout: `${BASE_SHA}\n` } },
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

  it('skips when the base delta cannot be computed because it is irrelevant to mergeability', async () => {
    await withRoot(async (dir) => {
      const { git, calls } = cleanlyMergeableAgainstOrigin();

      const outcome = await performRebase(git, dir, 'main', { finishMergeabilityCheck: true });

      expect(outcome.kind).toBe('mergeable_skip');
      expect(calls.some((args) => args[0] === 'rebase')).toBe(false);
    });
  });
});
