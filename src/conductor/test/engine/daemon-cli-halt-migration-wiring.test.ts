import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runDaemonMode, runOwnedHaltClassMigration } from '../../src/daemon-cli.js';

describe('daemon halt-class migration startup wiring', () => {
  it('creates the worktree base and migrates after ownership, before normal work', async () => {
    const calls: string[] = ['lock'];
    const lock = { owned: true };

    const result = await runOwnedHaltClassMigration(lock, '/repo', {
      ensureWorktreeBase: vi.fn(async () => {
        calls.push('worktree-base');
      }),
      migrateHaltClasses: vi.fn(async () => {
        calls.push('migration');
      }),
      log: vi.fn(),
    });

    calls.push('discovery', 're-kick');

    expect(result).toBe('/repo/.worktrees');
    expect(calls).toEqual(['lock', 'worktree-base', 'migration', 'discovery', 're-kick']);
  });

  it('does no migration or normal work when ownership acquisition fails', async () => {
    const ensureWorktreeBase = vi.fn(async () => {});
    const migrateHaltClasses = vi.fn(async () => {});
    const normalWork = vi.fn();

    const result = await runOwnedHaltClassMigration(null, '/repo', {
      ensureWorktreeBase,
      migrateHaltClasses,
      log: vi.fn(),
    });
    if (result !== null) normalWork();

    expect(result).toBeNull();
    expect(ensureWorktreeBase).not.toHaveBeenCalled();
    expect(migrateHaltClasses).not.toHaveBeenCalled();
    expect(normalWork).not.toHaveBeenCalled();
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
