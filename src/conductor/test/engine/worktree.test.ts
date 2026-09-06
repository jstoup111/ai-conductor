// Covers: task:20
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import {
  slugify,
  WorktreeLifecycleQueue,
  WorktreeManager,
  checkPrMerged,
} from '../../src/engine/worktree.js';
import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

describe('engine/worktree', () => {
  describe('slugify', () => {
    it('returns lowercase with spaces as hyphens', () => {
      expect(slugify('URL shortener service')).toBe('url-shortener-service');
    });

    it('truncates at 50 characters', () => {
      const long = 'a very long feature description that definitely exceeds fifty characters in length';
      const result = slugify(long);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('removes special characters', () => {
      expect(slugify('hello@world! (v2.0)')).toBe('helloworld-v20');
    });
  });

  describe('WorktreeManager', () => {
    let tempDir: string;
    let manager: WorktreeManager;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'worktree-test-'));
      await git(tempDir, 'init');
      await git(tempDir, 'config', 'user.email', 'test@test.com');
      await git(tempDir, 'config', 'user.name', 'Test');
      await git(tempDir, 'commit', '--allow-empty', '-m', 'init');
      manager = new WorktreeManager(tempDir);
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    describe('create', () => {
      it('creates .worktrees/<slug> directory', async () => {
        const result = await manager.create('URL shortener service');
        const expected = join(tempDir, '.worktrees', 'url-shortener-service');
        expect(result.path).toBe(expected);
        const s = await stat(expected);
        expect(s.isDirectory()).toBe(true);
      });

      it('creates branch feature/<slug>', async () => {
        const result = await manager.create('URL shortener service');
        expect(result.branch).toBe('feature/url-shortener-service');
        const branches = await git(tempDir, 'branch', '--list', 'feature/url-shortener-service');
        expect(branches).toContain('feature/url-shortener-service');
      });
    });

    describe('scan', () => {
      it('returns list of active worktrees', async () => {
        await manager.create('feature alpha');
        await manager.create('feature beta');
        const list = await manager.scan();
        expect(list).toHaveLength(2);
        const names = list.map((w) => w.name).sort();
        expect(names).toEqual(['feature-alpha', 'feature-beta']);
      });

      it('handles deleted branch gracefully', async () => {
        await manager.create('orphan feature');
        // Delete the branch from inside the worktree (simulate a deleted branch scenario)
        // The worktree dir still exists but the branch ref might be broken
        // Scan should still return the entry without crashing
        const wtPath = join(tempDir, '.worktrees', 'orphan-feature');
        // Corrupt the HEAD to simulate a deleted branch
        const { writeFile: wf } = await import('fs/promises');
        await wf(join(wtPath, '.git'), 'garbage', 'utf-8');
        const list = await manager.scan();
        // Should still include it (graceful handling)
        expect(list.some((w) => w.name === 'orphan-feature')).toBe(true);
      });

      it('excludes completed features', async () => {
        await manager.create('feature alpha');
        await manager.create('feature beta');
        // Mark beta as complete
        const betaPath = join(tempDir, '.worktrees', 'feature-beta');
        await writeFile(
          join(betaPath, 'conduct-state.json'),
          JSON.stringify({ feature_status: 'complete' }),
        );
        const list = await manager.scan();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('feature-alpha');
      });

      it('skips corrupt conduct-state.json and keeps valid worktrees', async () => {
        // Create two worktrees
        await manager.create('valid feature');
        await manager.create('corrupt feature');

        // Write corrupt JSON to one worktree's conduct-state.json
        const corruptPath = join(tempDir, '.worktrees', 'corrupt-feature');
        await writeFile(
          join(corruptPath, 'conduct-state.json'),
          '{invalid json syntax: ',
        );

        // Scan should return only the valid worktree, not throw
        const list = await manager.scan();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('valid-feature');
      });
    });

    describe('create (edge cases)', () => {
      it('reuses existing worktree for same branch', async () => {
        const first = await manager.create('my feature');
        const second = await manager.create('my feature');
        expect(second.path).toBe(first.path);
        expect(second.branch).toBe(first.branch);
      });

      it('creates .worktrees/ directory if it does not exist', async () => {
        // tempDir has no .worktrees/ yet — create should make it
        const worktreesDir = join(tempDir, '.worktrees');
        // Verify it doesn't exist before
        await expect(stat(worktreesDir)).rejects.toThrow();
        await manager.create('new feature');
        const s = await stat(worktreesDir);
        expect(s.isDirectory()).toBe(true);
      });

      it('appends -2 suffix on slug collision with different branch', async () => {
        // Note: collision means slug dir exists but is not a reusable worktree,
        // so a new slug with -2 suffix (and matching branch) is used
        // Create first worktree
        await manager.create('my feature');
        // Manually create a directory that would collide but isn't a valid git worktree
        const { mkdir: mkdirFs } = await import('fs/promises');
        // Remove the worktree properly first, then recreate dir to simulate collision
        const slugDir = join(tempDir, '.worktrees', 'my-feature');
        await git(tempDir, 'worktree', 'remove', slugDir);
        await mkdirFs(slugDir, { recursive: true });
        // Now create again — the slug dir exists but isn't a worktree
        const result = await manager.create('my feature');
        expect(result.path).toBe(join(tempDir, '.worktrees', 'my-feature-2'));
      });
    });

    describe('cleanup', () => {
      it('removes worktree and deletes branch', async () => {
        await manager.create('cleanup target');
        const wtPath = join(tempDir, '.worktrees', 'cleanup-target');
        // Verify it exists
        const s = await stat(wtPath);
        expect(s.isDirectory()).toBe(true);
        // Cleanup
        await manager.cleanup('cleanup-target');
        // Verify directory is gone
        await expect(stat(wtPath)).rejects.toThrow();
        // Verify branch is gone
        const branches = await git(tempDir, 'branch', '--list', 'feature/cleanup-target');
        expect(branches).toBe('');
      });
    });
  });

  describe('daemon worktree lifecycle', () => {
    let lifecycleRoot: string;

    beforeEach(async () => {
      lifecycleRoot = await mkdtemp(join(tmpdir(), 'daemon-worktree-lifecycle-'));
      await git(lifecycleRoot, 'init', '--initial-branch=main');
      await git(lifecycleRoot, 'config', 'user.email', 'daemon-worktree@example.test');
      await git(lifecycleRoot, 'config', 'user.name', 'Daemon Worktree Test');
      await writeFile(join(lifecycleRoot, 'README.md'), 'fixture\n');
      await git(lifecycleRoot, 'add', 'README.md');
      await git(lifecycleRoot, 'commit', '-m', 'fixture');
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(lifecycleRoot, { recursive: true, force: true });
    });

    it('runs lifecycle requests one at a time and continues after a failed request', async () => {
      const queue = new WorktreeLifecycleQueue();
      const events: string[] = [];
      let releaseFirst!: () => void;
      const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
      let markFirstStarted!: () => void;
      const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

      const first = queue.run(async () => {
        events.push('first:start');
        markFirstStarted();
        await firstReleased;
        events.push('first:fail');
        throw new Error('expected lifecycle failure');
      });
      const second = queue.run(async () => {
        events.push('second:start');
      });

      await firstStarted;
      await Promise.resolve();
      expect(events).toEqual(['first:start']);
      releaseFirst();
      await expect(first).rejects.toThrow('expected lifecycle failure');
      await expect(second).resolves.toBeUndefined();
      expect(events).toEqual(['first:start', 'first:fail', 'second:start']);
    });

    it('serializes concurrent add and remove requests against one shared git directory for 20 iterations', async () => {
      const originalRun = WorktreeLifecycleQueue.prototype.run;
      let activeLifecycleOperations = 0;
      let peakLifecycleOperations = 0;
      const lifecycleRun = vi.spyOn(WorktreeLifecycleQueue.prototype, 'run').mockImplementation(
        function <T>(this: WorktreeLifecycleQueue, operation: () => Promise<T>): Promise<T> {
          return originalRun.call(this, async () => {
            activeLifecycleOperations += 1;
            peakLifecycleOperations = Math.max(peakLifecycleOperations, activeLifecycleOperations);
            try {
              return await operation();
            } finally {
              activeLifecycleOperations -= 1;
            }
          }) as Promise<T>;
        },
      );
      const deps = makeFeatureRunnerDeps({
        projectRoot: lifecycleRoot,
        worktreeBase: join(lifecycleRoot, '.worktrees'),
        baseBranch: 'main',
        runConductorInWorktree: async () => {},
      });
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const slugA = `add-${iteration}`;
        const slugB = `remove-${iteration}`;
        const pathB = join(lifecycleRoot, '.worktrees', slugB);
        await git(lifecycleRoot, 'worktree', 'add', '-b', `feat/daemon-${slugB}`, pathB, 'main');

        const [created] = await Promise.all([
          deps.createWorktree(slugA),
          deps.teardownWorktree({ path: pathB, branch: `feat/daemon-${slugB}` }, false),
        ]);

        expect(created).toEqual({
          path: join(lifecycleRoot, '.worktrees', slugA),
          branch: `feat/daemon-${slugA}`,
        });
        const registrations = await git(lifecycleRoot, 'worktree', 'list', '--porcelain');
        expect(registrations).toContain(`worktree ${created.path}`);
        expect(registrations).not.toContain(`worktree ${pathB}`);
      }

      expect(lifecycleRun).toHaveBeenCalledTimes(40);
      expect(peakLifecycleOperations).toBe(1);
    });

    it('keeps an unrelated stale registration when a failed cleanup targets only its requested slug', async () => {
      const manager = new WorktreeManager(lifecycleRoot);
      const unrelated = await manager.create('unrelated feature');
      // A missing directory leaves B registered. The old global `worktree prune`
      // in A's failure path would silently reap it.
      await rm(unrelated.path, { recursive: true, force: true });
      const failedCleanupPath = join(lifecycleRoot, '.worktrees', 'failed-cleanup');
      await writeFile(failedCleanupPath, 'not a worktree');

      await manager.cleanup('failed-cleanup');

      const registered = await git(lifecycleRoot, 'worktree', 'list', '--porcelain');
      expect(registered).toContain(`worktree ${unrelated.path}`);
      expect(registered).not.toContain(`worktree ${failedCleanupPath}`);
    });
  });

  describe('checkPrMerged', () => {
    it('returns true when PR state is MERGED', async () => {
      // Mock execFile to simulate `gh pr view` returning MERGED
      const { execFile: realExecFile } = await import('child_process');
      const originalExecFile = realExecFile;

      // We test via the exported function which uses its own execFile
      // Use vi.mock for child_process within checkPrMerged
      const result = await checkPrMerged('https://github.com/test/repo/pull/1', async () => {
        return JSON.stringify({ state: 'MERGED' });
      });
      expect(result).toBe(true);
    });

    it('returns false when PR state is OPEN', async () => {
      const result = await checkPrMerged('https://github.com/test/repo/pull/1', async () => {
        return JSON.stringify({ state: 'OPEN' });
      });
      expect(result).toBe(false);
    });

    it('returns false when gh command fails', async () => {
      const result = await checkPrMerged('https://github.com/test/repo/pull/1', async () => {
        throw new Error('gh not found');
      });
      expect(result).toBe(false);
    });
  });
});
