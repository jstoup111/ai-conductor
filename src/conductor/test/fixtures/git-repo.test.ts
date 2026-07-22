import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTestRepo, commitAll } from './git-repo.js';

describe('initTestRepo', () => {
  it('creates a working git repo at dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-repo-fixture-'));
    try {
      await initTestRepo(dir);

      const inside = execSync('git rev-parse --is-inside-work-tree', { cwd: dir }).toString().trim();
      expect(inside).toBe('true');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies expected durability/no-repack config locally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-repo-fixture-'));
    try {
      await initTestRepo(dir);

      const gcAuto = execSync('git config --get gc.auto', { cwd: dir }).toString().trim();
      const maintAuto = execSync('git config --get maintenance.auto', { cwd: dir }).toString().trim();

      expect(gcAuto).toBe('0');
      expect(maintAuto).toBe('false');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not write config to the global/user git config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-repo-fixture-'));
    try {
      await initTestRepo(dir);

      let globalHasMaintAuto = true;
      try {
        execSync('git config --global --get maintenance.auto');
      } catch {
        globalHasMaintAuto = false;
      }

      expect(globalHasMaintAuto).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('commitAll', () => {
  it('stages all changes and produces a commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-repo-fixture-'));
    try {
      await initTestRepo(dir);
      await writeFile(join(dir, 'file.txt'), 'hello');

      await commitAll(dir, 'add file');

      const log = execSync('git log --format=%s', { cwd: dir }).toString().trim();
      expect(log).toBe('add file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
