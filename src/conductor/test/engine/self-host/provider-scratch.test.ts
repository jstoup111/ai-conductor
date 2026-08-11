import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveScratchHome } from '../../../src/engine/self-host/provider-scratch.js';

describe('provider scratch homes', () => {
  it('resolves beneath the owning worktree', () => {
    expect(resolveScratchHome({ worktreeRoot: '/wt', runId: 'R', attempt: 2, provider: 'codex' })).toBe(
      '/wt/.daemon/scratch/R/2-codex',
    );
  });

  it.each([
    ['worktree root', { runId: 'R', attempt: 2, provider: 'codex' }],
    ['run id', { worktreeRoot: '/wt', attempt: 2, provider: 'codex' }],
    ['attempt', { worktreeRoot: '/wt', runId: 'R', provider: 'codex' }],
    ['provider', { worktreeRoot: '/wt', runId: 'R', attempt: 2 }],
  ])('rejects a missing %s', (missing, options) => {
    expect(() => resolveScratchHome(options as Parameters<typeof resolveScratchHome>[0])).toThrow(missing);
  });

  it('does not fall back to the current or main worktree root', async () => {
    const source = await readFile(new URL('../../../src/engine/self-host/provider-scratch.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/process\.cwd|mainRoot|resolveMainRoot/);
  });

  it('remains in the worktree when pipeline state is relocated', async () => {
    const mainRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-main-'));
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'provider-scratch-worktree-'));
    const relocatedPipeline = await mkdtemp(join(tmpdir(), 'provider-scratch-pipeline-'));

    try {
      await symlink(relocatedPipeline, join(worktreeRoot, '.pipeline'));

      const home = resolveScratchHome({ worktreeRoot, runId: 'R', attempt: 2, provider: 'codex' });
      await mkdir(home, { recursive: true });

      const [realWorktree, realHome] = await Promise.all([realpath(worktreeRoot), realpath(home)]);

      expect(relative(realWorktree, realHome)).not.toMatch(/^\.\.(?:[/\\]|$)/);
      expect(realHome).not.toContain(mainRoot);
    } finally {
      await Promise.all([rm(mainRoot, { recursive: true, force: true }), rm(worktreeRoot, { recursive: true, force: true }), rm(relocatedPipeline, { recursive: true, force: true })]);
    }
  });
});
