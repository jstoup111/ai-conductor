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
  });
});
