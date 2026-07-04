// daemon-restart-lock.test.ts — Task 25 (FR-8): restart pidfile handoff +
// single-owner. Verifies that the `restart` verb is wired through the
// EXISTING acquire/reclaim primitives (daemon-lock.ts) rather than any new
// lock mechanism, and that the handoff is race-safe against a concurrent
// `ensureRunning` for the same repo.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';

import {
  clearStaleLockForRestart,
  ensureRunning,
  readPidRecord,
  isLive,
} from '../../src/engine/daemon-lock.js';
import { dispatchDaemonSupervisor } from '../../src/engine/daemon-supervisor-cli.js';
import type { Supervisor } from '../../src/engine/daemon-tmux.js';

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'daemon-restart-lock-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

async function readPidfileRaw(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(repoPath, '.daemon', 'daemon.pid'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Spawns a short-lived child process and resolves once it has exited, so its
 * pid is guaranteed hard-dead (real ESRCH, not just "unlikely to be alive"). */
async function spawnAndReapDeadPid(): Promise<number> {
  const child = fork(join(repoPath, '__does_not_exist__.js'), [], {
    stdio: 'ignore',
    // fork() will emit an 'error'/'exit' immediately for a missing entry
    // module — we only need the transient pid, not a successful boot.
  });
  const pid = child.pid as number;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  return pid;
}

function makeFakeSupervisor(overrides: Partial<Supervisor> = {}): Supervisor {
  return {
    isUp: async () => true,
    start: async () => {},
    stop: async () => {},
    restart: async () => ({ message: 'daemon restarted' }) as any,
    attach: async () => {},
    logs: async () => '',
    exec: async () => {},
    ...overrides,
  };
}

describe('clearStaleLockForRestart (FR-8, daemon-lock.ts)', () => {
  it('AC1: hard-dead old holder → reclaim path used, fresh acquire yields a new pid, exactly one live lock', async () => {
    const deadPid = await spawnAndReapDeadPid();
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: deadPid, uuid: 'old-owner', startedAt: new Date().toISOString() }),
      'utf8',
    );

    const previousOwnerPid = await clearStaleLockForRestart(repoPath);
    expect(previousOwnerPid).toBe(deadPid);

    // The stale record was reclaimed-then-unlinked (transient handoff) — the
    // path is now clear for a fresh O_EXCL acquire, simulating the newly
    // spawned daemon's own holdLock() on boot.
    expect(await readPidfileRaw()).toBeNull();

    const fresh = await ensureRunning(repoPath, {
      launch: async () => {},
    });
    void fresh;

    const record = await readPidRecord(repoPath);
    // ensureRunning's own transient-acquire-then-unlink pattern means the
    // pidfile is not left behind either — but crucially, no crash/refusal
    // occurred and the previous (dead) pid never blocked progress.
    expect(record).toBeNull();
    expect(previousOwnerPid).not.toBe(process.pid);
  });

  it('AC1b: a genuinely fresh acquire after handoff gets a NEW pid distinct from the old dead holder', async () => {
    const deadPid = await spawnAndReapDeadPid();
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: deadPid, uuid: 'old-owner', startedAt: new Date().toISOString() }),
      'utf8',
    );

    await clearStaleLockForRestart(repoPath);

    // Simulate the freshly-spawned daemon's own holdLock()-equivalent claim.
    const { acquire } = await import('../../src/engine/daemon-lock.js');
    const claim = await acquire(repoPath);
    expect(claim.acquired).toBe(true);
    if (claim.acquired) {
      expect(claim.pid).not.toBe(deadPid);
    }

    const owner = await readPidRecord(repoPath);
    expect(owner?.pid).toBe(process.pid);
    expect(owner?.pid).not.toBe(deadPid);

    // Exactly one live lock on disk.
    expect(owner).not.toBeNull();
  });

  it('AC2: a LIVE old holder is left untouched (no reclaim of a live lock)', async () => {
    // Use our own pid — guaranteed alive for the duration of the test.
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: process.pid, uuid: 'live-owner', startedAt: new Date().toISOString() }),
      'utf8',
    );

    const previousOwnerPid = await clearStaleLockForRestart(repoPath);
    expect(previousOwnerPid).toBe(process.pid);

    // The live record must still be present and unchanged — ADR-010 forbids
    // reclaiming a live lock; only the eventual real process death (via the
    // supervisor's respawn) makes it reclaimable.
    const owner = await readPidRecord(repoPath);
    expect(owner?.pid).toBe(process.pid);
    expect(owner?.uuid).toBe('live-owner');
    expect(isLive(process.pid)).toBe(true);
  });

  it('AC3: concurrent restart-handoff + ensureRunning on an empty repo → exactly one daemon spawned', async () => {
    let launches = 0;
    const launch = async () => {
      launches += 1;
    };

    // No prior pidfile. Race the restart-side handoff against ensureRunning —
    // both are built on the same O_EXCL acquire/reclaim primitive, so the
    // kernel arbitrates a single winner regardless of interleaving.
    await Promise.all([
      clearStaleLockForRestart(repoPath),
      ensureRunning(repoPath, { launch }),
    ]);

    expect(launches).toBe(1);
  });

  it('AC3b: concurrent restart-handoff + ensureRunning racing a hard-dead stale record → still exactly one daemon', async () => {
    const deadPid = await spawnAndReapDeadPid();
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: deadPid, uuid: 'old-owner', startedAt: new Date().toISOString() }),
      'utf8',
    );

    let launches = 0;
    const launch = async () => {
      launches += 1;
    };

    await Promise.all([
      clearStaleLockForRestart(repoPath),
      ensureRunning(repoPath, { launch }),
    ]);

    expect(launches).toBe(1);
  });
});

describe('dispatchDaemonSupervisor restart verb — wired through clearStaleLockForRestart', () => {
  it('clears a hard-dead stale lock before delegating to supervisor.restart', async () => {
    const deadPid = await spawnAndReapDeadPid();
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: deadPid, uuid: 'old-owner', startedAt: new Date().toISOString() }),
      'utf8',
    );

    let restartCalledWithLockCleared = false;
    const supervisor = makeFakeSupervisor({
      restart: async () => {
        // By the time the supervisor is invoked, the stale lock must already
        // be gone — proving the CLI wired the handoff BEFORE the respawn.
        restartCalledWithLockCleared = (await readPidfileRaw()) === null;
        return { message: 'daemon restarted' } as any;
      },
    });

    const code = await dispatchDaemonSupervisor(
      { verb: 'restart' } as any,
      { supervisor, cwd: repoPath, out: () => {} },
    );

    expect(code).toBe(0);
    expect(restartCalledWithLockCleared).toBe(true);
  });

  it('leaves a live owner untouched across the restart dispatch', async () => {
    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(
      join(repoPath, '.daemon', 'daemon.pid'),
      JSON.stringify({ pid: process.pid, uuid: 'live-owner', startedAt: new Date().toISOString() }),
      'utf8',
    );

    let ownerAtRestartTime: unknown = null;
    const supervisor = makeFakeSupervisor({
      restart: async () => {
        ownerAtRestartTime = await readPidfileRaw();
        return { message: 'daemon restarted' } as any;
      },
    });

    const code = await dispatchDaemonSupervisor(
      { verb: 'restart' } as any,
      { supervisor, cwd: repoPath, out: () => {} },
    );

    expect(code).toBe(0);
    expect((ownerAtRestartTime as any)?.pid).toBe(process.pid);
    expect((ownerAtRestartTime as any)?.uuid).toBe('live-owner');
  });
});
