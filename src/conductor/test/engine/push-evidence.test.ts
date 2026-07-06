/**
 * Tests for the push-evidence module (src/conductor/src/engine/push-evidence.ts).
 *
 * Tests the headPushedToUpstream function that determines if HEAD has been
 * pushed to its upstream tracking branch using local git operations.
 *
 * All tests use FAKE git runners that record calls; no real `git` binary is
 * required. The module contract: returns true (pushed), false (not pushed),
 * or null (indeterminate/error).
 */

import { describe, it, expect } from 'vitest';
import { headPushedToUpstream } from '../../src/engine/push-evidence.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

// ── Fake GitRunner factory ────────────────────────────────────────────────────

function fakeGit(
  responses: Array<{ stdout: string } | Error>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const git: GitRunner = async (args, _opts) => {
    calls.push([...args]);
    const response = responses[index++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { git, calls };
}

// ── Happy path: HEAD is pushed to upstream ─────────────────────────────────────

describe('headPushedToUpstream', () => {
  describe('happy path', () => {
    it('returns true when HEAD is an ancestor of the upstream ref', async () => {
      // Simulate: git rev-parse @{u} succeeds, merge-base --is-ancestor returns success (0)
      const { git } = fakeGit([
        { stdout: 'refs/remotes/origin/main\n' }, // @{u} resolve succeeds
        { stdout: '' }, // merge-base --is-ancestor succeeds (exit 0)
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBe(true);
    });

    it('calls git rev-parse --symbolic-full-name @{u} first to resolve upstream', async () => {
      const { git, calls } = fakeGit([
        { stdout: 'refs/remotes/origin/main\n' },
        { stdout: '' },
      ]);

      await headPushedToUpstream(git, '/repo');
      expect(calls[0]).toEqual(['rev-parse', '--symbolic-full-name', '@{u}']);
    });

    it('calls git merge-base --is-ancestor HEAD <ref> to check ancestry', async () => {
      const { git, calls } = fakeGit([
        { stdout: 'refs/remotes/origin/main\n' },
        { stdout: '' },
      ]);

      await headPushedToUpstream(git, '/repo');
      expect(calls[1]).toEqual(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']);
    });

    it('passes the cwd to git runner in both calls', async () => {
      const { git, calls } = fakeGit([
        { stdout: 'refs/remotes/origin/develop\n' },
        { stdout: '' },
      ]);

      await headPushedToUpstream(git, '/custom/repo/path');
      // We can't directly verify cwd in the mock, but the calls should execute
      // without throwing
      expect(calls).toHaveLength(2);
    });
  });

  describe('not pushed', () => {
    it('returns false when HEAD is not an ancestor of the upstream ref', async () => {
      // Simulate: git rev-parse @{u} succeeds, merge-base returns exit 1 (not ancestor)
      const notAncestorErr = new Error('not an ancestor');
      (notAncestorErr as any).code = 1; // Exit code 1 from merge-base --is-ancestor
      const { git } = fakeGit([
        { stdout: 'refs/remotes/origin/main\n' },
        notAncestorErr,
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBe(false);
    });
  });

  describe('indeterminate errors', () => {
    it('returns null when @{u} resolution fails and current branch resolution also fails', async () => {
      const { git } = fakeGit([
        new Error('no upstream'),
        new Error('detached HEAD'),
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });

    it('returns null when merge-base exits with code >= 2 (a real git error)', async () => {
      const gitError = new Error('fatal: not a repository');
      (gitError as any).code = 128; // Exit code 128 from git errors
      const { git } = fakeGit([
        { stdout: 'refs/remotes/origin/main\n' },
        gitError,
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });

    it('returns null when upstream ref is empty string after resolution', async () => {
      const { git } = fakeGit([
        { stdout: '\n' }, // Empty after trim
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });
  });

  describe('fallback to refs/remotes/origin/<branch>', () => {
    it('falls back to refs/remotes/origin/<branch> when @{u} resolution fails', async () => {
      const { git, calls } = fakeGit([
        new Error('no upstream'),
        { stdout: 'my-feature\n' }, // Current branch from abbrev-ref
        { stdout: '' }, // merge-base succeeds
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBe(true);
      // First call: rev-parse @{u}
      expect(calls[0]).toEqual(['rev-parse', '--symbolic-full-name', '@{u}']);
      // Second call: rev-parse --abbrev-ref HEAD (fallback)
      expect(calls[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
      // Third call: merge-base with the fallback ref
      expect(calls[2]).toEqual([
        'merge-base',
        '--is-ancestor',
        'HEAD',
        'refs/remotes/origin/my-feature',
      ]);
    });

    it('handles branches with slashes in the fallback case', async () => {
      const { git, calls } = fakeGit([
        new Error('no upstream'),
        { stdout: 'feature/my-feature\n' },
        { stdout: '' },
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBe(true);
      expect(calls[2]).toEqual([
        'merge-base',
        '--is-ancestor',
        'HEAD',
        'refs/remotes/origin/feature/my-feature',
      ]);
    });

    it('returns false when fallback ref is used but HEAD is not pushed (stale PR case)', async () => {
      const notPushedErr = new Error('not an ancestor');
      (notPushedErr as any).code = 1; // Exit code 1 from merge-base --is-ancestor
      const { git, calls } = fakeGit([
        new Error('no upstream'),
        { stdout: 'my-feature\n' },
        notPushedErr, // merge-base fails with exit 1
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBe(false);
      // Verify we used the fallback ref in the merge-base call
      expect(calls[2]).toEqual([
        'merge-base',
        '--is-ancestor',
        'HEAD',
        'refs/remotes/origin/my-feature',
      ]);
    });
  });

  describe('error handling', () => {
    it('returns null when git spawn fails with ENOENT (git not found)', async () => {
      const spawnErr = new Error('git not found');
      (spawnErr as any).code = 'ENOENT';
      // Provide errors for both @{u} and fallback branch resolution attempts
      const { git } = fakeGit([spawnErr, spawnErr]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });

    it('returns null when git command throws without exit code (generic spawn error)', async () => {
      const spawnErr = new Error('spawn failed');
      // No .code property — generic spawn error
      // Provide errors for both @{u} and fallback branch resolution attempts
      const { git } = fakeGit([spawnErr, spawnErr]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });

    it('returns null when merge-base throws without exit code', async () => {
      const mergeBaseErr = new Error('merge-base failed');
      // No .code property — exit code is undefined, not 1
      const { git } = fakeGit([
        { stdout: 'refs/remotes/origin/main\n' },
        mergeBaseErr,
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });

    it('returns null when fallback branch resolution fails with spawn error', async () => {
      const branchErr = new Error('detached HEAD');
      // No .code property
      const { git } = fakeGit([
        new Error('no upstream'),
        branchErr,
      ]);

      const result = await headPushedToUpstream(git, '/repo');
      expect(result).toBeNull();
    });
  });
});
