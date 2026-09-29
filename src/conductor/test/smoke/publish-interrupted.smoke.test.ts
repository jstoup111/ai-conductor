import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, lstat, access } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
export const smokeCapability = 'toolchain';

const REPO_ROOT = resolve(join(process.cwd(), '..', '..'));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('bin/setup worktree compatibility', () => {
  it(
    'creates a worktree-local dist/ symlink without touching the primary checkout',
    { timeout: 600_000 },
    async (ctx) => {
      const primaryDistLink = join(REPO_ROOT, 'src', 'conductor', 'dist');
      const primaryStatBefore = await lstat(primaryDistLink).catch(() => undefined);
      const worktreeDir = await mkdtemp(join(tmpdir(), 'bin-setup-worktree-'));
      const branchName = `bin-setup-smoke-${Date.now()}`;
      try {
        await execa('git', ['worktree', 'add', '-b', branchName, worktreeDir, 'HEAD'], {
          cwd: REPO_ROOT,
        });
        if (!(await exists(join(worktreeDir, 'bin', 'setup')))) {
          ctx.skip();
          return;
        }
        await execa(join(worktreeDir, 'bin', 'setup'), [], {
          cwd: worktreeDir,
          env: { ...process.env, CI: 'true' },
        });
        const worktreeDistLink = join(worktreeDir, 'src', 'conductor', 'dist');
        expect((await lstat(worktreeDistLink)).isSymbolicLink()).toBe(true);
        expect(await exists(join(worktreeDir, 'src', 'conductor', 'dist', 'index.js'))).toBe(true);
        const primaryStatAfter = await lstat(primaryDistLink).catch(() => undefined);
        expect(primaryStatAfter?.isSymbolicLink()).toBe(primaryStatBefore?.isSymbolicLink());
        if (primaryStatBefore) expect(primaryStatAfter?.mtimeMs).toBe(primaryStatBefore.mtimeMs);
      } finally {
        await execa('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: REPO_ROOT }).catch(() => {});
        await execa('git', ['branch', '-D', branchName], { cwd: REPO_ROOT }).catch(() => {});
        await rm(worktreeDir, { recursive: true, force: true });
      }
    },
  );
});
