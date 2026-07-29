import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runDaemonMode } from '../../src/daemon-cli.js';

// `runOwnedHaltClassMigration` (the production default behind
// `opts.runHaltClassMigration`) is intentionally NOT exported from
// daemon-cli.ts — see the comment on its definition. These tests exercise it
// only through the public `runDaemonMode` surface: the first two drive the
// real (non-injected) default to prove the worktree-base-then-migration
// ordering happens before any normal daemon work, and the third proves the
// DI seam itself is wired (an injected replacement is actually invoked, in
// order, ahead of discovery/re-kick).
describe('daemon halt-class migration startup wiring', () => {
  it('creates the worktree base and migrates via the production default, before normal work', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-migration-default-'));
    const calls: string[] = [];
    const lock = {
      pid: process.pid,
      uuid: 'migration-default',
      owned: true,
      release: vi.fn(async () => {}),
      releaseSync: vi.fn(),
    };
    const lockModule = await import('../../src/engine/daemon-lock.js');
    const daemonModule = await import('../../src/engine/daemon.js');
    const haltMigrationModule = await import('../../src/engine/halt-class-migration.js');
    vi.spyOn(lockModule, 'holdLock').mockResolvedValue(lock);
    vi.spyOn(haltMigrationModule, 'migrateLegacyHaltClasses').mockImplementation(async () => {
      calls.push('migration');
    });
    vi.spyOn(daemonModule, 'runDaemon').mockImplementation(async () => {
      calls.push('normal-work');
      throw new Error('__stop_after_startup_wiring__');
    });

    try {
      await expect(
        runDaemonMode({
          projectRoot,
          concurrency: 1,
          baseBranch: 'main',
          ensureFresh: async () => {},
        }),
      ).rejects.toThrow('__stop_after_startup_wiring__');

      // The production default (`runOwnedHaltClassMigration`) creates the
      // worktree base directory before migrating and before normal work runs.
      expect(existsSync(join(projectRoot, '.worktrees'))).toBe(true);
      expect(calls).toEqual(['migration', 'normal-work']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('does no migration or normal work when lock ownership acquisition fails', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-migration-no-lock-'));
    const lockModule = await import('../../src/engine/daemon-lock.js');
    const daemonModule = await import('../../src/engine/daemon.js');
    const haltMigrationModule = await import('../../src/engine/halt-class-migration.js');
    vi.spyOn(lockModule, 'holdLock').mockResolvedValue(null);
    const migrateSpy = vi
      .spyOn(haltMigrationModule, 'migrateLegacyHaltClasses')
      .mockImplementation(async () => {});
    const runDaemonSpy = vi.spyOn(daemonModule, 'runDaemon').mockImplementation(async () => {});
    const exitProcess = vi.fn();

    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        exitProcess,
      });

      expect(exitProcess).toHaveBeenCalled();
      expect(existsSync(join(projectRoot, '.worktrees'))).toBe(false);
      expect(migrateSpy).not.toHaveBeenCalled();
      expect(runDaemonSpy).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('wires migration before discovery and re-kick setup in runDaemonMode', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-migration-order-'));
    const calls: string[] = [];
    const lock = {
      pid: process.pid,
      uuid: 'migration-order',
      owned: true,
      release: vi.fn(async () => {}),
      releaseSync: vi.fn(),
    };
    const lockModule = await import('../../src/engine/daemon-lock.js');
    const daemonModule = await import('../../src/engine/daemon.js');
    vi.spyOn(lockModule, 'holdLock').mockResolvedValue(lock);
    vi.spyOn(daemonModule, 'runDaemon').mockImplementation(async () => {
      calls.push('normal-work');
      throw new Error('__stop_after_startup_wiring__');
    });

    try {
      await expect(
        runDaemonMode({
          projectRoot,
          concurrency: 1,
          baseBranch: 'main',
          ensureFresh: async () => {},
          runHaltClassMigration: async () => {
            calls.push('migration');
            return join(projectRoot, '.worktrees');
          },
        }),
      ).rejects.toThrow('__stop_after_startup_wiring__');

      expect(calls).toEqual(['migration', 'normal-work']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});
