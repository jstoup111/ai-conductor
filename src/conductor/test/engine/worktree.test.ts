import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { slugify, WorktreeManager } from '../../src/engine/worktree.js';

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
});
