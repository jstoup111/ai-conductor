// ─────────────────────────────────────────────────────────────────────────────
// Task 5 (RED): runDaemonMode must call holdLock() (pidfile acquisition)
// BEFORE ensureFresh() (the publish/GC-triggering install-freshness check),
// so the pidfile — which records this daemon's own engine version — is in
// place and observable to any self-guard check for the entire window
// ensureFresh/publish/GC can run in. Previously ensureFresh ran first,
// leaving a startup window where GC could self-evict the running daemon's
// dist before the pidfile backstop existed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Task 5 — runDaemonMode calls holdLock before ensureFresh', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-ensurefresh-order-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('invokes holdLock before ensureFresh (ordering)', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');

    const order: string[] = [];
    const fakeLock = {
      pid: process.pid,
      uuid: 'fake-uuid',
      owned: true,
      release: async () => {},
      releaseSync: () => {},
    };
    vi.spyOn(holdLockModule, 'holdLock').mockImplementation(async () => {
      order.push('holdLock');
      return fakeLock;
    });

    const ensureFresh = async () => {
      order.push('ensureFresh');
    };

    // Force an early, deterministic bail-out right after ensureFresh so we
    // don't have to stand up the whole daemon loop. runDaemon isn't
    // supplied, so once ensureFresh resolves the daemon loop machinery
    // beyond it may throw; we only care about the ordering captured above.
    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        ensureFresh,
        exitProcess: () => {
          throw new Error('__stop__');
        },
        runDaemon: async () => {
          throw new Error('__stop__');
        },
      } as any);
    } catch {
      // Expected — we only assert call order below.
    }

    expect(order).toEqual(['holdLock', 'ensureFresh']);
  });

  it('propagates an ensureFresh throw (stale-install refusal) after the lock is held, with releaseSync available as the exit backstop', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    const holdLockModule = await import('../../src/engine/daemon-lock.js');

    let releaseSyncCalled = false;
    const fakeLock = {
      pid: process.pid,
      uuid: 'fake-uuid',
      owned: true,
      release: async () => {},
      releaseSync: () => {
        releaseSyncCalled = true;
      },
    };
    vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(fakeLock as any);

    const refusalError = new Error('stale harness install');
    const ensureFresh = async () => {
      throw refusalError;
    };

    await expect(
      runDaemonMode({
        projectRoot,
        concurrency: 1,
        ensureFresh,
        exitProcess: () => {},
      } as any),
    ).rejects.toThrow('stale harness install');

    // The exit backstop is registered via process.once('exit', ...) prior to
    // ensureFresh running (verified by the throw propagating cleanly rather
    // than crashing before the lock/backstop wiring); simulate process exit
    // to confirm the backstop this test process registered actually releases.
    process.emit('exit', 0 as any);
    expect(releaseSyncCalled).toBe(true);
  });
});
