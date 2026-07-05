/**
 * Acceptance (RED) specs for the dedicated transient resolution worktree
 * (story: "Resolution runs in a dedicated transient worktree",
 * .docs/stories/auto-resolve-open-pr-conflicts.md; adr-2026-07-04-resolution-
 * worktree-lifecycle).
 *
 * Covers: FR-12 (isolation aspect), NFR-2
 *
 * These are true end-to-end acceptance specs: a REAL git repo in a tmpdir (no
 * mocked git), driving the not-yet-existing `withResolveWorktree` helper the
 * plan (Task 4/5) assigns to `src/engine/autoresolve.ts`. Every test imports
 * the module dynamically inside the `it()` body so a missing module produces a
 * genuine per-test FAILED result (RED), not a suite-level collection error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

describe('integration/autoresolve — resolution worktree lifecycle', () => {
  let dir: string;
  const g = (args: string[]) => execFile('git', args, { cwd: dir });

  async function worktreeList(): Promise<string> {
    const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: dir });
    return stdout;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autoresolve-worktree-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(dir, 'README.md'), '# base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat/widget']);
    await writeFile(join(dir, 'feature.txt'), 'branch tip content\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feature work']);
    await g(['checkout', '-q', 'main']);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a worktree at .worktrees/resolve-<slug> checked out at the PR branch tip, prepares the namespace before fn runs, and tears it down on success (FR-12/NFR-2 happy)', async () => {
    const autoresolve = await import('../../src/engine/autoresolve.js');
    let sawNamespaceBeforeFn = false;
    const result = await autoresolve.withResolveWorktree(
      'widget',
      'feat/widget',
      dir,
      async (worktreePath: string) => {
        const content = await readFile(join(worktreePath, 'feature.txt'), 'utf-8');
        expect(content).toBe('branch tip content\n');
        const env = await readFile(join(worktreePath, '.env'), 'utf-8').catch(() => '');
        sawNamespaceBeforeFn = env.includes('WORKTREE_NAMESPACE');
        return { ok: true };
      },
    );

    expect(sawNamespaceBeforeFn).toBe(true);
    expect(result).toEqual({ ok: true });
    const list = await worktreeList();
    expect(list).not.toContain('resolve-widget');
  });

  it('tears down the worktree even when the attempt function throws (failure teardown)', async () => {
    const autoresolve = await import('../../src/engine/autoresolve.js');
    await expect(
      autoresolve.withResolveWorktree('widget', 'feat/widget', dir, async () => {
        throw new Error('suite went red');
      }),
    ).rejects.toThrow('suite went red');

    const list = await worktreeList();
    expect(list).not.toContain('resolve-widget');
  });

  it('force-removes and recreates a stale leftover resolve-<slug> directory from a crashed prior run (negative: dirty leftover)', async () => {
    const staleDir = join(dir, '.worktrees', 'resolve-widget');
    await mkdir(staleDir, { recursive: true });
    await writeFile(join(staleDir, 'stale-garbage.txt'), 'leftover from a crashed attempt\n');

    const autoresolve = await import('../../src/engine/autoresolve.js');
    let sawFreshCheckout = false;
    await autoresolve.withResolveWorktree('widget', 'feat/widget', dir, async (worktreePath: string) => {
      const garbage = await readFile(join(worktreePath, 'stale-garbage.txt'), 'utf-8').catch(
        () => null,
      );
      expect(garbage).toBeNull();
      const content = await readFile(join(worktreePath, 'feature.txt'), 'utf-8');
      sawFreshCheckout = content === 'branch tip content\n';
      return { ok: true };
    });

    expect(sawFreshCheckout).toBe(true);
  });

  it('never starts a second resolution worktree while one is in flight (serial guard, worktree story negative)', async () => {
    const autoresolve = await import('../../src/engine/autoresolve.js');
    let secondCallSeen = false;
    const first = autoresolve.withResolveWorktree('widget', 'feat/widget', dir, async () => {
      // While the first attempt holds the worktree, a second call for the SAME
      // slug must be rejected/deferred, not attempt a concurrent worktree add.
      await expect(
        autoresolve.withResolveWorktree('widget', 'feat/widget', dir, async () => {
          secondCallSeen = true;
          return { ok: true };
        }),
      ).rejects.toBeTruthy();
      return { ok: true };
    });
    await first;
    expect(secondCallSeen).toBe(false);
  });

  it('calls injected prepareWorktree function during worktree setup (namespace prep injection)', async () => {
    const autoresolve = await import('../../src/engine/autoresolve.js');
    const calls: string[] = [];
    const mockPrepareWorktree = async (worktreePath: string): Promise<void> => {
      calls.push(worktreePath);
      // Simulate namespace writing like the real prepareWorktree does
      await writeFile(join(worktreePath, '.env'), 'WORKTREE_NAMESPACE=resolve_widget\n', 'utf-8');
    };

    const result = await autoresolve.withResolveWorktree(
      'widget',
      'feat/widget',
      dir,
      async (worktreePath: string) => {
        // Verify the prep was called before fn runs
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBe(join(dir, '.worktrees', 'resolve-widget'));
        // Verify namespace is present in .env
        const env = await readFile(join(worktreePath, '.env'), 'utf-8');
        expect(env).toContain('WORKTREE_NAMESPACE=resolve_widget');
        return { ok: true };
      },
      mockPrepareWorktree,
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it('uses default prepareWorktree when not injected (backward compatibility)', async () => {
    const autoresolve = await import('../../src/engine/autoresolve.js');
    const result = await autoresolve.withResolveWorktree(
      'widget-default',
      'feat/widget',
      dir,
      async (worktreePath: string) => {
        // Default behavior should still write namespace
        const env = await readFile(join(worktreePath, '.env'), 'utf-8').catch(() => '');
        expect(env).toContain('WORKTREE_NAMESPACE');
        return { ok: true };
      },
    );

    expect(result).toEqual({ ok: true });
  });
});
