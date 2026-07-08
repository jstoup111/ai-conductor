import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseDirtyStatus, enumerateCandidates } from '../../src/engine/leak-triage.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('engine/leak-triage', () => {
  describe('parseDirtyStatus', () => {
    it('parses empty status output', () => {
      const result = parseDirtyStatus('');
      expect(result).toEqual({
        modified: [],
        untracked: [],
        staged: [],
      });
    });

    it('parses a modified file not staged ( M)', () => {
      const result = parseDirtyStatus(' M src/file.ts\n');
      expect(result.modified).toContain('src/file.ts');
      expect(result.untracked).toHaveLength(0);
      expect(result.staged).toHaveLength(0);
    });

    it('parses a modified file staged (M )', () => {
      const result = parseDirtyStatus('M  src/file.ts\n');
      expect(result.staged).toContain('src/file.ts');
      expect(result.modified).toHaveLength(0);
      expect(result.untracked).toHaveLength(0);
    });

    it('parses a file modified in both index and working tree (MM)', () => {
      const result = parseDirtyStatus('MM src/file.ts\n');
      expect(result.modified).toContain('src/file.ts');
      expect(result.staged).toContain('src/file.ts');
      expect(result.untracked).toHaveLength(0);
    });

    it('parses an untracked file (??)', () => {
      const result = parseDirtyStatus('?? src/new.ts\n');
      expect(result.untracked).toContain('src/new.ts');
      expect(result.modified).toHaveLength(0);
      expect(result.staged).toHaveLength(0);
    });

    it('parses a renamed file (R  old.ts -> new.ts)', () => {
      const result = parseDirtyStatus('R  old.ts -> new.ts\n');
      expect(result.modified).toContain('old.ts -> new.ts');
      expect(result.untracked).toHaveLength(0);
      expect(result.staged).toHaveLength(0);
    });

    it('parses multiple files with mixed statuses', () => {
      const output = ` M src/modified.ts
M  src/staged.ts
MM src/both.ts
?? src/new.ts
R  old.ts -> new.ts
`;
      const result = parseDirtyStatus(output);
      expect(result.modified).toContain('src/modified.ts');
      expect(result.modified).toContain('src/both.ts');
      expect(result.modified).toContain('old.ts -> new.ts');
      expect(result.staged).toContain('src/staged.ts');
      expect(result.staged).toContain('src/both.ts');
      expect(result.untracked).toContain('src/new.ts');
    });

    it('preserves file paths with spaces', () => {
      const result = parseDirtyStatus('?? "src/file with spaces.ts"\n');
      expect(result.untracked.length).toBeGreaterThan(0);
    });

    it('handles deleted files (D  or  D)', () => {
      const resultStaged = parseDirtyStatus('D  src/deleted.ts\n');
      expect(resultStaged.modified).toContain('src/deleted.ts');

      const resultUnstaged = parseDirtyStatus(' D src/deleted.ts\n');
      expect(resultUnstaged.modified).toContain('src/deleted.ts');
    });

    it('ignores blank lines', () => {
      const output = ` M src/file1.ts

M  src/file2.ts
`;
      const result = parseDirtyStatus(output);
      expect(result.modified).toContain('src/file1.ts');
      expect(result.staged).toContain('src/file2.ts');
    });
  });

  describe('enumerateCandidates', () => {
    let tempDir: string;
    let git: GitRunner;

    beforeEach(async () => {
      // Create a temporary directory for the test repo
      tempDir = await mkdtemp(join(tmpdir(), 'leak-triage-test-'));
      git = makeGitRunner(tempDir);

      // Initialize a git repo with a main branch
      await git(['init']);
      await git(['config', 'user.email', 'test@example.com']);
      await git(['config', 'user.name', 'Test User']);

      // Create an initial commit on main
      await git(['commit', '--allow-empty', '-m', 'Initial commit']);
    });

    afterEach(async () => {
      // Clean up the temporary directory
      await rm(tempDir, { recursive: true, force: true });
    });

    it('returns empty array when there are no feat branches', async () => {
      const result = await enumerateCandidates(git);
      expect(result).toEqual([]);
    });

    it('returns feat/* branches excluding worktree branches when there are no worktrees', async () => {
      // Create local feat/y branch
      await git(['branch', 'feat/y']);

      const result = await enumerateCandidates(git);
      expect(result).toEqual(['feat/y']);
    });

    it('returns worktree branches before other feat branches', async () => {
      // Create a local feat/y branch
      await git(['branch', 'feat/y']);

      // Create a worktree on feat/daemon-x
      await git(['checkout', '-b', 'feat/daemon-x']);
      const worktreePath = join(tempDir, '..', 'worktree-daemon-x');
      await git(['worktree', 'add', worktreePath, 'feat/daemon-x']);

      const result = await enumerateCandidates(git);
      // Worktree branch (feat/daemon-x) should come first, then feat/y
      expect(result[0]).toBe('feat/daemon-x');
      expect(result).toContain('feat/y');
    });

    it('returns multiple worktree branches before non-worktree branches', async () => {
      // Create multiple feat branches
      await git(['checkout', '-b', 'feat/y']);
      await git(['checkout', 'main']);
      await git(['checkout', '-b', 'feat/z']);

      // Create worktrees on feat/daemon-x and feat/daemon-w
      await git(['checkout', '-b', 'feat/daemon-x']);
      const worktree1 = join(tempDir, '..', 'worktree-daemon-x');
      await git(['worktree', 'add', worktree1, 'feat/daemon-x']);

      await git(['checkout', 'main']);
      await git(['checkout', '-b', 'feat/daemon-w']);
      const worktree2 = join(tempDir, '..', 'worktree-daemon-w');
      await git(['worktree', 'add', worktree2, 'feat/daemon-w']);

      const result = await enumerateCandidates(git);

      // All worktree branches should come first
      const worktreeBranches = result.filter((b) => b.includes('daemon'));
      expect(worktreeBranches.length).toBe(2);
      expect(result.indexOf('feat/daemon-x')).toBeLessThan(result.indexOf('feat/y'));
      expect(result.indexOf('feat/daemon-w')).toBeLessThan(result.indexOf('feat/z'));
    });

    it('handles repo with no feat branches at all', async () => {
      const result = await enumerateCandidates(git);
      expect(result).toEqual([]);
    });

    it('includes worktree branch even if no other feat branches exist', async () => {
      // Create only a worktree branch
      await git(['checkout', '-b', 'feat/daemon-x']);
      const worktreePath = join(tempDir, '..', 'worktree-daemon-x');
      await git(['worktree', 'add', worktreePath, 'feat/daemon-x']);

      const result = await enumerateCandidates(git);
      expect(result).toEqual(['feat/daemon-x']);
    });
  });
});
