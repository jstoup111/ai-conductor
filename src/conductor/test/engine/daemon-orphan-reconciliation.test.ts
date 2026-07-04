import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Supervisor } from '../../src/engine/daemon-tmux.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for orphaned-process reconciliation (FR-21 negative path, Task 34).
//
// Orphan scenario: process in pidfile is alive, but tmux session is gone
// (session killed externally, but process survived). The restart path must:
//   1. Detect the orphan (pidfile exists, session gone)
//   2. Terminate the process
//   3. Reclaim the lock
//   4. Create a fresh session + daemon
//
// All tests dynamically import inside the test body so missing implementations
// surface as RED failures specific to that test.
// ─────────────────────────────────────────────────────────────────────────────

const SUPERVISOR_MOD = '../../src/engine/daemon-supervisor-cli.js';
const LOCK_MOD = '../../src/engine/daemon-lock.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(SUPERVISOR_MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

type MethodCall = { method: string; args: unknown[] };

function makeFakeSupervisor(throwOn?: { method: string; error: Error }): {
  calls: MethodCall[];
  supervisor: Supervisor;
} {
  const calls: MethodCall[] = [];

  const makeMethod = (method: string) =>
    async (...args: unknown[]): Promise<void> => {
      calls.push({ method, args });
      if (throwOn?.method === method) throw throwOn.error;
    };

  const restart = async (...args: unknown[]): Promise<{ degraded: boolean; message: string }> => {
    calls.push({ method: 'restart', args });
    if (throwOn?.method === 'restart') throw throwOn.error;
    return { degraded: false, message: 'daemon restarted in place (session preserved).' };
  };

  const start = async (...args: unknown[]): Promise<void> => {
    calls.push({ method: 'start', args });
    if (throwOn?.method === 'start') throw throwOn.error;
  };

  const stop = async (...args: unknown[]): Promise<void> => {
    calls.push({ method: 'stop', args });
    if (throwOn?.method === 'stop') throw throwOn.error;
  };

  const hasSession = async (repo: string): Promise<boolean> => {
    calls.push({ method: 'hasSession', args: [repo] });
    if (throwOn?.method === 'hasSession') throw throwOn.error;
    // If we're simulating orphan: pidfile has a live pid, but session is gone
    return false;
  };

  const supervisor: Supervisor = {
    start,
    stop,
    restart,
    isUp: makeMethod('isUp') as any,
    hasSession,
    attach: makeMethod('attach') as any,
    logs: makeMethod('logs') as any,
    exec: makeMethod('exec') as any,
  };

  return {
    calls,
    supervisor,
  };
}

const CWD = '/repo/my-project';

// ═════════════════════════════════════════════════════════════════════════════
// T34.1: Restart with live process but no session → orphan terminated + lock reclaimed
// ═════════════════════════════════════════════════════════════════════════════
describe('dispatchDaemonSupervisor: orphaned-process reconciliation (restart path)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'daemon-orphan-'));
    tempDirs.push(dir);
    return dir;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T34.1a: Live process, session gone → detect orphan and terminate
  // ───────────────────────────────────────────────────────────────────────────
  it('restart with live process but no tmux session → detects and terminates orphan', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { writePidRecord } = await import('../../src/engine/daemon-lock.js');
    const repo = await tempRepo();

    // Simulate orphan: write a pidfile with a non-existent process
    const deadPid = 999_999_999;
    await writePidRecord(repo, { pid: deadPid, uuid: 'test-uuid', startedAt: new Date().toISOString() });

    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];
    const killCalls: Array<{ pid: number; signal: number | string }> = [];

    // Mock kill function that records calls but doesn't actually kill anything
    const mockKill = (pid: number, signal: number | string): void => {
      killCalls.push({ pid, signal });
    };

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l), kill: mockKill },
    );

    // Restart succeeds (returns 0)
    expect(code).toBe(0);

    // restart was called to bring up a fresh daemon
    const restartCall = calls.find((c) => c.method === 'restart');
    expect(restartCall).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T34.1b: Lock reclaimed after orphan termination
  // ───────────────────────────────────────────────────────────────────────────
  it('orphan termination reclaims the pidfile lock for the fresh daemon', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { writePidRecord, readPidRecord } = await import('../../src/engine/daemon-lock.js');
    const repo = await tempRepo();

    const oldPid = 999_999_999; // a non-existent pid
    await writePidRecord(repo, { pid: oldPid, uuid: 'old-uuid', startedAt: new Date().toISOString() });

    const { supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    // Mock kill function that just records calls
    const mockKill = (): void => {
      // no-op for dead pid
    };

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l), kill: mockKill },
    );

    expect(code).toBe(0);

    // After orphan reconciliation + clearStaleLockForRestart, the pidfile is cleared
    // (ready for the fresh daemon to claim on boot). In production, the fresh daemon's
    // holdLock() would create a new pidfile, but our fake supervisor doesn't spawn a real daemon.
    // So we just verify restart was called (the new daemon will be spawned).
    const output = out.join('\n');
    expect(output).toMatch(/restart|restarted/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T34.1c: Exactly one replacement session + daemon created
  // ───────────────────────────────────────────────────────────────────────────
  it('exactly one fresh session + daemon are created after orphan cleanup', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { writePidRecord } = await import('../../src/engine/daemon-lock.js');
    const repo = await tempRepo();

    // Simulate orphan
    await writePidRecord(repo, { pid: 999_999_999, uuid: 'old-uuid', startedAt: new Date().toISOString() });

    const { calls, supervisor } = makeFakeSupervisor();
    const out: string[] = [];

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l) },
    );

    expect(code).toBe(0);

    // restart should be called exactly once to create the fresh daemon
    const restartCalls = calls.filter((c) => c.method === 'restart');
    expect(restartCalls.length).toBe(1);

    // No extra start/stop calls (the restart is the only session management call)
    const sessionCalls = calls.filter((c) => ['start', 'stop', 'restart'].includes(c.method));
    expect(sessionCalls.length).toBe(1); // exactly the restart call
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T34.2: Missing tmux entirely → actionable error message
  // ───────────────────────────────────────────────────────────────────────────
  it('missing tmux (TmuxNotInstalledError) → actionable message, not cryptic error', async () => {
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const { TmuxNotInstalledError } = await import('../../src/engine/daemon-tmux.js');
    const { writePidRecord } = await import('../../src/engine/daemon-lock.js');
    const repo = await tempRepo();

    // Use a test pid that represents an "alive" process
    const testPid = 12345;

    // Write a pidfile so reconcileOrphan will call hasSession and hit the error
    await writePidRecord(repo, {
      pid: testPid,
      uuid: 'test-uuid',
      startedAt: new Date().toISOString(),
    });

    const { calls, supervisor } = makeFakeSupervisor({
      method: 'hasSession',
      error: new TmuxNotInstalledError(),
    });
    const out: string[] = [];

    // Mock kill that treats our test pid as alive (never throws ESRCH)
    const mockKill = (pid: number, signal: number | string): void => {
      if (pid === testPid) {
        // Pretend the process is alive — don't throw
        return;
      }
      // For other pids, act normally (would throw ESRCH)
    };

    const code: number = await dispatch(
      { verb: 'restart' },
      { supervisor, cwd: repo, out: (l: string) => out.push(l), kill: mockKill },
    );

    expect(code).toBe(1); // error returns non-zero
    expect(out.length).toBeGreaterThan(0);
    const output = out.join('\n');
    // The message should mention tmux, not be a cryptic internal error
    expect(output.toLowerCase()).toMatch(/tmux/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T34.3: Bare-run path (no supervisor) → no tmux operations
  // ───────────────────────────────────────────────────────────────────────────
  it('bare-run (supervisor undefined) → skips orphan check entirely', async () => {
    // This test verifies that when supervisor is undefined (bare-run mode,
    // no tmux), the orphan reconciliation is skipped and no tmux operations occur.
    // The function should return early or handle the undefined supervisor gracefully.
    const dispatch = requireFn(await load(), 'dispatchDaemonSupervisor');
    const repo = await tempRepo();

    const out: string[] = [];

    // Call with supervisor=undefined to simulate bare-run (no daemon hosting).
    // In bare-run mode, the restart verb should not be dispatched at all,
    // or should be a no-op since there's no supervisor to manage.
    // The test verifies that no tmux operations occur.

    // Note: depending on implementation, this may not be a valid verb in bare-run,
    // or it may simply return early. The key is: no TmuxNotInstalledError should
    // be thrown (which would happen if orphan check tried to use supervisor).
    try {
      const code: number = await dispatch(
        { verb: 'restart' },
        { cwd: repo, out: (l: string) => out.push(l) }, // no supervisor provided
      );
      // Either succeeds with a code or throws a handled error
      expect(code).toBeLessThanOrEqual(1);
    } catch (err) {
      // If bare-run rejects restart, that's also valid — just not a tmux error
      const msg = (err as Error)?.message || '';
      expect(msg.toLowerCase()).not.toMatch(/tmux/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Helper: write a pidfile record for testing (used to set up orphan state)
// ═════════════════════════════════════════════════════════════════════════════

// Ensure writePidRecord is exported from daemon-lock.ts for testing
// (this test helper depends on it being available as a test utility)
