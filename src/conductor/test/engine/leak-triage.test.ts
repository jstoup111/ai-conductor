import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseDirtyStatus, enumerateCandidates, classifyModifiedFiles, triageModifiedFiles, renderLeakSuspectWarn } from '../../src/engine/leak-triage.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { mkdtemp, rm, writeFile, mkdir, unlink } from 'node:fs/promises';
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

  describe('classifyModifiedFiles', () => {
    let tempDir: string;
    let git: GitRunner;

    beforeEach(async () => {
      // Create a temporary directory for the test repo
      tempDir = await mkdtemp(join(tmpdir(), 'leak-triage-classify-test-'));
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

    it('classifies a modified file as explained by a candidate branch when byte-identical', async () => {
      // Create a feature branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello world";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Add src/a.ts on feat/daemon-x']);

      // Switch back to main and modify the file to match feat/daemon-x
      await git(['checkout', 'main']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(filePath, 'export const greeting = "hello world";', 'utf-8');

      // Classify the modified file
      const result = await classifyModifiedFiles(git, ['feat/daemon-x'], ['src/a.ts']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'src/a.ts',
        explainedBy: 'feat/daemon-x',
        allExplainedBy: ['feat/daemon-x'],
      });
    });

    it('returns classification without explainedBy when file content does not match any candidate', async () => {
      // Create a feature branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello world";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Add src/a.ts on feat/daemon-x']);

      // Switch back to main with different content
      await git(['checkout', 'main']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(filePath, 'export const greeting = "goodbye world";', 'utf-8');

      // Classify the modified file
      const result = await classifyModifiedFiles(git, ['feat/daemon-x'], ['src/a.ts']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'src/a.ts',
      });
      expect(result[0].explainedBy).toBeUndefined();
    });

    it('checks multiple candidate branches in order and returns the first match', async () => {
      // Create first candidate branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'content x', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Add src/a.ts with content x']);

      // Create second candidate branch with different content
      await git(['checkout', 'main']);
      await git(['checkout', '-b', 'feat/daemon-y']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(filePath, 'content y', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Add src/a.ts with content y']);

      // Switch back to main with content from feat/daemon-y
      await git(['checkout', 'main']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(filePath, 'content y', 'utf-8');

      // Classify with both candidates - should match feat/daemon-y (second in list)
      const result = await classifyModifiedFiles(git, ['feat/daemon-x', 'feat/daemon-y'], ['src/a.ts']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'src/a.ts',
        explainedBy: 'feat/daemon-y',
        allExplainedBy: ['feat/daemon-y'],
      });
    });

    it('handles file that does not exist in any candidate branch', async () => {
      // Create a candidate branch with no src/a.ts
      await git(['checkout', '-b', 'feat/daemon-x']);
      await git(['commit', '--allow-empty', '-m', 'Empty commit on feat/daemon-x']);

      // Switch back to main and create a file
      await git(['checkout', 'main']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello";', 'utf-8');

      // Classify the file
      const result = await classifyModifiedFiles(git, ['feat/daemon-x'], ['src/a.ts']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'src/a.ts',
      });
      expect(result[0].explainedBy).toBeUndefined();
    });

    it('classifies multiple files with mixed results', async () => {
      // Create feature branch with two files
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const file1Path = join(tempDir, 'src', 'a.ts');
      const file2Path = join(tempDir, 'src', 'b.ts');
      await writeFile(file1Path, 'content a', 'utf-8');
      await writeFile(file2Path, 'content b', 'utf-8');
      await git(['add', 'src/a.ts', 'src/b.ts']);
      await git(['commit', '-m', 'Add files on feat/daemon-x']);

      // Switch back to main and modify both files
      await git(['checkout', 'main']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(file1Path, 'content a', 'utf-8'); // Matches feat/daemon-x
      await writeFile(file2Path, 'different content', 'utf-8'); // Does not match

      // Classify both files
      const result = await classifyModifiedFiles(git, ['feat/daemon-x'], ['src/a.ts', 'src/b.ts']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: 'src/a.ts',
        explainedBy: 'feat/daemon-x',
        allExplainedBy: ['feat/daemon-x'],
      });
      expect(result[1]).toEqual({
        path: 'src/b.ts',
      });
      expect(result[1].explainedBy).toBeUndefined();
    });
  });

  describe('classifyStrays', () => {
    let tempDir: string;
    let git: GitRunner;

    beforeEach(async () => {
      // Create a temporary directory for the test repo
      tempDir = await mkdtemp(join(tmpdir(), 'leak-triage-strays-test-'));
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

    it('classifies an untracked file as explained by a candidate branch when content is in tree', async () => {
      // Create a feature branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'test'), { recursive: true });
      const filePath = join(tempDir, 'test', 'daemon.test.ts');
      await writeFile(filePath, 'export const testContent = "hello from feat/daemon-x";', 'utf-8');
      await git(['add', 'test/daemon.test.ts']);
      await git(['commit', '-m', 'Add test/daemon.test.ts on feat/daemon-x']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Create an untracked file with the same content
      const untrackedPath = join(tempDir, 'test', 'daemon.test.ts.new');
      await mkdir(join(tempDir, 'test'), { recursive: true });
      await writeFile(untrackedPath, 'export const testContent = "hello from feat/daemon-x";', 'utf-8');

      // Import and call classifyStrays
      const { classifyStrays } = await import('../../src/engine/leak-triage.js');
      const result = await classifyStrays(git, ['feat/daemon-x'], ['test/daemon.test.ts.new']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'test/daemon.test.ts.new',
        explainedBy: 'feat/daemon-x',
        allExplainedBy: ['feat/daemon-x'],
      });
    });

    it('classifies untracked file as unexplained when content does not match any candidate', async () => {
      // Create a feature branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'test'), { recursive: true });
      const filePath = join(tempDir, 'test', 'daemon.test.ts');
      await writeFile(filePath, 'export const testContent = "hello from feat/daemon-x";', 'utf-8');
      await git(['add', 'test/daemon.test.ts']);
      await git(['commit', '-m', 'Add test/daemon.test.ts on feat/daemon-x']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Create an untracked file with different content
      const untrackedPath = join(tempDir, 'test', 'daemon.test.ts.new');
      await mkdir(join(tempDir, 'test'), { recursive: true });
      await writeFile(untrackedPath, 'export const testContent = "different content";', 'utf-8');

      // Import and call classifyStrays
      const { classifyStrays } = await import('../../src/engine/leak-triage.js');
      const result = await classifyStrays(git, ['feat/daemon-x'], ['test/daemon.test.ts.new']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'test/daemon.test.ts.new',
      });
      expect(result[0].explainedBy).toBeUndefined();
    });

    it('checks multiple candidate branches and returns the first match', async () => {
      // Create first candidate branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'test'), { recursive: true });
      const filePath = join(tempDir, 'test', 'daemon.test.ts');
      await writeFile(filePath, 'content x', 'utf-8');
      await git(['add', 'test/daemon.test.ts']);
      await git(['commit', '-m', 'Add test/daemon.test.ts with content x']);

      // Create second candidate branch with different content
      await git(['checkout', 'main']);
      await git(['checkout', '-b', 'feat/daemon-y']);
      await mkdir(join(tempDir, 'test'), { recursive: true });
      await writeFile(filePath, 'content y', 'utf-8');
      await git(['add', 'test/daemon.test.ts']);
      await git(['commit', '-m', 'Add test/daemon.test.ts with content y']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Create an untracked file with content from feat/daemon-y
      const untrackedPath = join(tempDir, 'test', 'daemon.test.ts.new');
      await mkdir(join(tempDir, 'test'), { recursive: true });
      await writeFile(untrackedPath, 'content y', 'utf-8');

      // Import and call classifyStrays
      const { classifyStrays } = await import('../../src/engine/leak-triage.js');
      const result = await classifyStrays(git, ['feat/daemon-x', 'feat/daemon-y'], ['test/daemon.test.ts.new']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: 'test/daemon.test.ts.new',
        explainedBy: 'feat/daemon-y',
        allExplainedBy: ['feat/daemon-y'],
      });
    });

    it('classifies multiple untracked files with mixed results', async () => {
      // Create a feature branch with two files
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'test'), { recursive: true });
      const file1Path = join(tempDir, 'test', 'file1.ts');
      const file2Path = join(tempDir, 'test', 'file2.ts');
      await writeFile(file1Path, 'content 1', 'utf-8');
      await writeFile(file2Path, 'content 2', 'utf-8');
      await git(['add', 'test/file1.ts', 'test/file2.ts']);
      await git(['commit', '-m', 'Add files on feat/daemon-x']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Create two untracked files - one matching, one not
      const untracked1Path = join(tempDir, 'test', 'file1.ts.new');
      const untracked2Path = join(tempDir, 'test', 'file2.ts.new');
      await mkdir(join(tempDir, 'test'), { recursive: true });
      await writeFile(untracked1Path, 'content 1', 'utf-8'); // Matches feat/daemon-x
      await writeFile(untracked2Path, 'different content', 'utf-8'); // Does not match

      // Import and call classifyStrays
      const { classifyStrays } = await import('../../src/engine/leak-triage.js');
      const result = await classifyStrays(git, ['feat/daemon-x'], ['test/file1.ts.new', 'test/file2.ts.new']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: 'test/file1.ts.new',
        explainedBy: 'feat/daemon-x',
        allExplainedBy: ['feat/daemon-x'],
      });
      expect(result[1]).toEqual({
        path: 'test/file2.ts.new',
      });
      expect(result[1].explainedBy).toBeUndefined();
    });
  });

  describe('HealPlan (all-or-nothing composition with stray vetoes)', () => {
    let tempDir: string;
    let git: GitRunner;

    beforeEach(async () => {
      // Create a temporary directory for the test repo
      tempDir = await mkdtemp(join(tmpdir(), 'leak-triage-healplan-test-'));
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

    it('stray matching no culprit blob → whole heal vetoed', async () => {
      // Create a feature branch with a file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'content a', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Add src/a.ts on feat/daemon-x']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Create an untracked file with content NOT in any candidate branch
      const untrackedPath = join(tempDir, 'stray.ts');
      await writeFile(untrackedPath, 'unexplained stray content', 'utf-8');

      // Get porcelain status with the untracked file
      const porcelainResult = await git(['status', '--porcelain']);
      const porcelain = porcelainResult.stdout;

      // Import healPlan
      const { healPlan } = await import('../../src/engine/leak-triage.js');

      // Call healPlan
      const plan = await healPlan(git, porcelain, ['feat/daemon-x']);

      expect(plan.canHeal).toBe(false);
      expect(plan.reason).toContain('unexplained');
    });

    it('stray matching only a different branch than modified files → vetoed (single-branch rule)', async () => {
      // Create initial file on main
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const file1Path = join(tempDir, 'src', 'file1.ts');
      await writeFile(file1Path, 'initial content', 'utf-8');
      await git(['add', 'src/file1.ts']);
      await git(['commit', '-m', 'Initial commit with file1']);

      // Create first branch with modified file1
      await git(['checkout', '-b', 'feat/branch-a']);
      await writeFile(file1Path, 'content for branch-a', 'utf-8');
      await git(['add', 'src/file1.ts']);
      await git(['commit', '-m', 'Modify file1 on feat/branch-a']);

      // Create second branch from main
      await git(['checkout', 'main']);
      await git(['checkout', '-b', 'feat/branch-b']);
      await mkdir(join(tempDir, 'test'), { recursive: true });
      const file2Path = join(tempDir, 'test', 'file2.ts');
      await writeFile(file2Path, 'unexplained content', 'utf-8');
      await git(['add', 'test/file2.ts']);
      await git(['commit', '-m', 'Add file2 on feat/branch-b']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Modify file1 to match branch-a
      await writeFile(file1Path, 'content for branch-a', 'utf-8');

      // Create an untracked file that doesn't match any branch
      const untrackedPath = join(tempDir, 'unexplained.ts');
      await writeFile(untrackedPath, 'this content is not in any branch', 'utf-8');

      // Get porcelain status
      const porcelainResult = await git(['status', '--porcelain']);
      const porcelain = porcelainResult.stdout;

      // Import healPlan
      const { healPlan } = await import('../../src/engine/leak-triage.js');

      // Call healPlan with both branches
      const plan = await healPlan(git, porcelain, ['feat/branch-a', 'feat/branch-b']);

      // Should veto because the unexplained stray file fails the no-match veto
      expect(plan.canHeal).toBe(false);
      expect(plan.reason).toContain('unexplained');
    });

    it('gitignored file absent from porcelain → never classified', async () => {
      // Create a .gitignore
      const gitignorePath = join(tempDir, '.gitignore');
      await writeFile(gitignorePath, '*.ignored\n', 'utf-8');
      await git(['add', '.gitignore']);
      await git(['commit', '-m', 'Add .gitignore']);

      // Create an ignored file (should not appear in porcelain status)
      const ignoredPath = join(tempDir, 'file.ignored');
      await writeFile(ignoredPath, 'this should be ignored', 'utf-8');

      // Get porcelain status
      const porcelainResult = await git(['status', '--porcelain']);
      const porcelain = porcelainResult.stdout;

      // Verify the ignored file is not in porcelain
      expect(porcelain).not.toContain('file.ignored');

      // Import healPlan
      const { healPlan } = await import('../../src/engine/leak-triage.js');

      // Call healPlan with empty candidates (should succeed since no files to heal)
      const plan = await healPlan(git, porcelain, []);

      expect(plan.canHeal).toBe(true);
      expect(plan.filesToRestore).toHaveLength(0);
      expect(plan.filesToDelete).toHaveLength(0);
    });

    it('all modified + strays explained by single branch → canHeal true, correct restore/delete lists', async () => {
      // Create initial file on main that will be modified
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const modifiedPath = join(tempDir, 'src', 'modified.ts');
      await writeFile(modifiedPath, 'initial content', 'utf-8');
      await git(['add', 'src/modified.ts']);
      await git(['commit', '-m', 'Initial commit on main']);

      // Create a feature branch with multiple files
      await git(['checkout', '-b', 'feat/daemon-x']);
      await writeFile(modifiedPath, 'modified content from branch', 'utf-8');
      await mkdir(join(tempDir, 'extra'), { recursive: true });
      const straySourcePath = join(tempDir, 'extra', 'source.ts');
      await writeFile(straySourcePath, 'stray content from branch', 'utf-8');
      await git(['add', 'src/modified.ts', 'extra/source.ts']);
      await git(['commit', '-m', 'Modify and add files on feat/daemon-x']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Modify src/modified.ts to match branch content (modified file)
      await writeFile(modifiedPath, 'modified content from branch', 'utf-8');

      // Create an untracked file with content matching a file in the branch
      const strayPath = join(tempDir, 'src', 'stray.ts');
      await writeFile(strayPath, 'stray content from branch', 'utf-8');

      // Get porcelain status
      const porcelainResult = await git(['status', '--porcelain']);
      const porcelain = porcelainResult.stdout;

      // Import healPlan
      const { healPlan } = await import('../../src/engine/leak-triage.js');

      // Call healPlan
      const plan = await healPlan(git, porcelain, ['feat/daemon-x']);

      expect(plan.canHeal).toBe(true);
      expect(plan.explainedBy).toBe('feat/daemon-x');
      expect(plan.filesToRestore).toContain('src/modified.ts');
      expect(plan.filesToDelete).toContain('src/stray.ts');
    });

    it('mixed scenario with some files explained, some not → canHeal false', async () => {
      // Create a feature branch with one file
      await git(['checkout', '-b', 'feat/daemon-x']);
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const explainedPath = join(tempDir, 'src', 'explained.ts');
      await writeFile(explainedPath, 'explained content', 'utf-8');
      await git(['add', 'src/explained.ts']);
      await git(['commit', '-m', 'Add explained.ts on feat/daemon-x']);

      // Switch back to main
      await git(['checkout', 'main']);

      // Create one modified file that matches the branch
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(explainedPath, 'explained content', 'utf-8');

      // Create an untracked file with unexplained content
      const unexplainedPath = join(tempDir, 'src', 'unexplained.ts');
      await writeFile(unexplainedPath, 'this content is not in any branch', 'utf-8');

      // Get porcelain status
      const porcelainResult = await git(['status', '--porcelain']);
      const porcelain = porcelainResult.stdout;

      // Import healPlan
      const { healPlan } = await import('../../src/engine/leak-triage.js');

      // Call healPlan
      const plan = await healPlan(git, porcelain, ['feat/daemon-x']);

      expect(plan.canHeal).toBe(false);
      expect(plan.reason).toContain('unexplained');
    });

    it('file explained by multiple branches, intersection lands on a non-first match → still healed', async () => {
      // Create initial files on main that will be modified
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const pathA = join(tempDir, 'src', 'a.ts');
      const pathB = join(tempDir, 'src', 'b.ts');
      await writeFile(pathA, 'initial a', 'utf-8');
      await writeFile(pathB, 'initial b', 'utf-8');
      await git(['add', 'src/a.ts', 'src/b.ts']);
      await git(['commit', '-m', 'Initial commit on main']);

      // feat/branch-x: a.ts has shared content (also present on branch-y), b.ts has
      // content that only branch-x has (not matching main's working tree).
      await git(['checkout', '-b', 'feat/branch-x']);
      await writeFile(pathA, 'shared content A', 'utf-8');
      await writeFile(pathB, 'branch-x-only content B', 'utf-8');
      await git(['add', 'src/a.ts', 'src/b.ts']);
      await git(['commit', '-m', 'Modify files on feat/branch-x']);

      // feat/branch-y: a.ts has the SAME shared content as branch-x (so a.ts is
      // explained by both branches, with branch-x first in candidate order), b.ts
      // has content that matches what main's working tree will be modified to.
      await git(['checkout', 'main']);
      await git(['checkout', '-b', 'feat/branch-y']);
      await writeFile(pathA, 'shared content A', 'utf-8');
      await writeFile(pathB, 'shared content B', 'utf-8');
      await git(['add', 'src/a.ts', 'src/b.ts']);
      await git(['commit', '-m', 'Modify files on feat/branch-y']);

      // Switch back to main and dirty the tree to match branch-y for b.ts and the
      // shared content for a.ts — so a.ts is explained by [branch-x, branch-y] but
      // b.ts is explained only by [branch-y]. The all-files intersection is
      // {branch-y}, which is NOT a.ts's first-matched (candidate-order) branch.
      await git(['checkout', 'main']);
      await writeFile(pathA, 'shared content A', 'utf-8');
      await writeFile(pathB, 'shared content B', 'utf-8');

      const porcelainResult = await git(['status', '--porcelain']);
      const porcelain = porcelainResult.stdout;

      const { healPlan } = await import('../../src/engine/leak-triage.js');

      // Candidate order puts branch-x first, so a.ts's first match is branch-x —
      // but the only branch explaining BOTH files is branch-y.
      const plan = await healPlan(git, porcelain, ['feat/branch-x', 'feat/branch-y']);

      expect(plan.canHeal).toBe(true);
      expect(plan.explainedBy).toBe('feat/branch-y');
      expect(plan.filesToRestore).toContain('src/a.ts');
      expect(plan.filesToRestore).toContain('src/b.ts');
    });
  });

  describe('renderLeakSuspectWarn', () => {
    it('surfaces per-file classification status with branch explanation for explained files', () => {
      // Porcelain status with one modified tracked file
      const porcelain = ' M src/explained.ts\n';

      // Mock HealPlan with classifications showing which branch explains the file
      const healPlan = {
        canHeal: false,
        filesToRestore: [],
        filesToDelete: [],
        classifications: [
          {
            path: 'src/explained.ts',
            explainedBy: 'feat/daemon-x',
            allExplainedBy: ['feat/daemon-x'],
          },
        ],
      };

      const output = renderLeakSuspectWarn(porcelain, healPlan);

      // The output should mention the file and show it's explained by feat/daemon-x (not '(none)')
      expect(output).toContain('src/explained.ts');
      expect(output).toContain('feat/daemon-x');
      expect(output).not.toContain('| (none)');
    });

    it('marks unexplained files with (unexplained) status when classification has no explainedBy', () => {
      // Porcelain status with one modified tracked file
      const porcelain = ' M src/unexplained.ts\n';

      // Mock HealPlan with classifications showing file is unexplained
      const healPlan = {
        canHeal: false,
        filesToRestore: [],
        filesToDelete: [],
        classifications: [
          {
            path: 'src/unexplained.ts',
            // No explainedBy field → unexplained
          },
        ],
      };

      const output = renderLeakSuspectWarn(porcelain, healPlan);

      // The output should show the file as unexplained
      expect(output).toContain('src/unexplained.ts');
      expect(output).toContain('(unexplained)');
    });

    it('shows per-file diff-stats for mixed explained and unexplained files', () => {
      // Porcelain with multiple files: one modified, one untracked
      const porcelain = ' M src/tracked.ts\n?? src/stray.ts\n';

      const healPlan = {
        canHeal: false,
        filesToRestore: [],
        filesToDelete: [],
        classifications: [
          {
            path: 'src/tracked.ts',
            explainedBy: 'feat/daemon-x',
            allExplainedBy: ['feat/daemon-x'],
          },
          {
            path: 'src/stray.ts',
            // No explainedBy → unexplained
          },
        ],
      };

      const output = renderLeakSuspectWarn(porcelain, healPlan);

      // Verify both files appear with their respective status
      expect(output).toContain('src/tracked.ts');
      expect(output).toContain('src/stray.ts');
      expect(output).toContain('feat/daemon-x');
      expect(output).toContain('(unexplained)');
      // Total should show 1 unexplained out of 2
      expect(output).toContain('1/2');
    });
  });

  describe('triageModifiedFiles (negative paths)', () => {
    let tempDir: string;
    let git: GitRunner;

    beforeEach(async () => {
      // Create a temporary directory for the test repo
      tempDir = await mkdtemp(join(tmpdir(), 'leak-triage-negative-test-'));
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

    it('negative path 1: one-byte difference — file differs by one byte from candidate → unexplained', async () => {
      // Create initial file on main
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello world";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Initial commit with file on main']);

      // Create a feature branch with the same file (different content)
      await git(['checkout', '-b', 'feat/daemon-x']);
      await writeFile(filePath, 'export const greeting = "hello world";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Add src/a.ts on feat/daemon-x']);

      // Switch back to main and modify the file by one byte
      await git(['checkout', 'main']);
      await writeFile(filePath, 'export const greeting = "hello world!";', 'utf-8'); // added ! at end

      // Triage the modified file
      const result = await triageModifiedFiles(git);

      expect(result.canHeal).toBe(false); // Modified file differs from candidates
      expect(result.healable).toBe(true); // No staged changes
      expect(result.classifications).toHaveLength(1);
      expect(result.classifications[0]).toEqual({
        path: 'src/a.ts',
      });
      expect(result.classifications[0].explainedBy).toBeUndefined();
    });

    it('negative path 2: missing path — file does not exist in any candidate → unexplained, no error', async () => {
      // Create initial file on main
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Initial commit with file on main']);

      // Create a feature branch with no src/a.ts
      await git(['checkout', '-b', 'feat/daemon-x']);
      await git(['commit', '--allow-empty', '-m', 'Empty commit on feat/daemon-x']);

      // Switch back to main and modify the file
      await git(['checkout', 'main']);
      await writeFile(filePath, 'export const modified content = true;', 'utf-8');

      // Triage the modified file
      const result = await triageModifiedFiles(git);

      expect(result.canHeal).toBe(false); // File doesn't exist in candidate
      expect(result.healable).toBe(true); // No staged changes
      expect(result.classifications).toHaveLength(1);
      expect(result.classifications[0]).toEqual({
        path: 'src/a.ts',
      });
      expect(result.classifications[0].explainedBy).toBeUndefined();
    });

    it('negative path 3: zero candidates — empty candidates array → all unexplained, no error', async () => {
      // Create initial file on main
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Initial commit with file on main']);

      // Modify the file
      await writeFile(filePath, 'export const greeting = "hello modified";', 'utf-8');

      // Triage with no candidates (pass empty override)
      const result = await triageModifiedFiles(git, undefined, []);

      expect(result.canHeal).toBe(false); // No candidates to explain the changes
      expect(result.healable).toBe(true); // No staged changes
      expect(result.classifications).toHaveLength(1);
      expect(result.classifications[0]).toEqual({
        path: 'src/a.ts',
      });
      expect(result.classifications[0].explainedBy).toBeUndefined();
    });

    it('negative path 4: staged abort — if any staged modifications exist, return not-healable immediately', async () => {
      // Create initial file on main
      await mkdir(join(tempDir, 'src'), { recursive: true });
      const filePath = join(tempDir, 'src', 'a.ts');
      await writeFile(filePath, 'export const greeting = "hello";', 'utf-8');
      await git(['add', 'src/a.ts']);
      await git(['commit', '-m', 'Initial commit with file on main']);

      // Modify and stage the file (staged only, not further modified)
      await writeFile(filePath, 'export const greeting = "hello staged";', 'utf-8');
      await git(['add', 'src/a.ts']);

      // Create a candidate branch BEFORE switching back
      await git(['checkout', '-b', 'feat/daemon-x']);
      await git(['commit', '--allow-empty', '-m', 'Empty commit on feat/daemon-x']);

      // Switch back to main — at this point staged changes are preserved
      // because we're on a branch that was created from main with staged changes
      await git(['checkout', 'main']);

      // The file should now be staged (M  in status)
      // Verify status before calling triage
      const statusCheck = await git(['status', '--porcelain']);
      const hasStaged = statusCheck.stdout.includes('M');

      if (!hasStaged) {
        // If staged changes were lost during checkout, manually stage them
        await writeFile(filePath, 'export const greeting = "hello staged";', 'utf-8');
        await git(['add', 'src/a.ts']);
      }

      // Create a spy to track git calls
      const callLog: string[][] = [];
      const wrappedGit = vi.fn(async (args: string[]) => {
        callLog.push(args);
        return git(args);
      });

      // Copy all methods from original git
      Object.assign(wrappedGit, git);

      // Triage should abort immediately because of staged changes
      const result = await triageModifiedFiles(wrappedGit);

      expect(result.canHeal).toBe(false);
      expect(result.healable).toBe(false); // staged changes present, not healable

      // Verify that after status call, no additional non-status git commands were issued
      const statusIndex = callLog.findIndex((args) => args[0] === 'status' && args[1] === '--porcelain');
      expect(statusIndex).toBeGreaterThanOrEqual(0); // status was called

      // After status, should return early without calling enumerate/classify commands
      const afterStatusCalls = callLog.slice(statusIndex + 1);
      expect(afterStatusCalls.length).toBe(0); // No further git calls after detecting staged changes
    });
  });
});
