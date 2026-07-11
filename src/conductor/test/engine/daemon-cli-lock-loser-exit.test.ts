// ─────────────────────────────────────────────────────────────────────────────
// Task 14: Lock-loser explicit exit (RED phase)
//
// Verifies that when runDaemonMode loses the lock (another daemon is running):
// 1. The injected exitProcess seam is called with code 0
// 2. "another daemon is already running" log line appears
// 3. Test FAILS with current code (RED phase) — no exit call is made yet
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DaemonModeOptions } from '../../src/daemon-cli.js';

describe('Task 14 — Lock-loser explicit exit (RED phase)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-cli-lock-loser-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  /**
   * Test: runDaemonMode loses lock → fake exitProcess seam is called with 0
   *
   * Setup:
   *   - Mock holdLock to return null (another daemon owns the lock)
   *   - Mock ensureFresh to no-op
   *   - Inject a fake exitProcess function to track calls
   *
   * Verify:
   *   - exitProcess is called exactly once with code 0
   *   - "another daemon is already running" appears in logged output
   *
   * RED PHASE: This test fails with current code because runDaemonMode
   * does NOT yet call the exit seam when lock is lost.
   */
  it('RED: fake exitProcess seam is NOT called with current code (fails)', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');

    // Mock holdLock to return null (simulating lock is held by another daemon)
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    const holdLockSpy = vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(null);

    // Capture logs to verify "another daemon is already running" appears
    const logs: string[] = [];
    const originalConsoleLog = console.log;
    console.log = vi.fn((...args: any[]) => {
      logs.push(args.map(a => String(a)).join(' '));
    });

    // Injected fake exitProcess to track calls
    let exitProcessCalled = false;
    let exitProcessCode: number | undefined;
    const fakeExitProcess = (code: number) => {
      exitProcessCalled = true;
      exitProcessCode = code;
    };

    const opts: DaemonModeOptions = {
      projectRoot,
      concurrency: 1,
      ensureFresh: async () => {}, // no-op
      exitProcess: fakeExitProcess,
    };

    // Call runDaemonMode
    await runDaemonMode(opts);

    // Verify exitProcess was called with 0 (RED assertion - currently fails with current code)
    expect(exitProcessCalled).toBe(true);
    expect(exitProcessCode).toBe(0);

    // Verify log line appears (this passes even with current code, just to document the message)
    const logText = logs.join('\n');
    expect(logText).toContain('another daemon is already running');

    // Cleanup
    console.log = originalConsoleLog;
    holdLockSpy.mockRestore();
  });

  /**
   * Test: "another daemon is already running" message is logged
   *
   * Verify that the daemon logs the expected message when lock is lost.
   * This is a sanity check that the lock-loss code path is being hit.
   */
  it('logs "another daemon is already running" message when lock is lost', async () => {
    const { runDaemonMode } = await import('../../src/daemon-cli.js');

    // Mock holdLock to return null
    const holdLockModule = await import('../../src/engine/daemon-lock.js');
    const holdLockSpy = vi.spyOn(holdLockModule, 'holdLock').mockResolvedValue(null);

    // Capture logs
    const logs: string[] = [];
    const originalConsoleLog = console.log;
    console.log = vi.fn((...args: any[]) => {
      logs.push(args.map(a => String(a)).join(' '));
    });

    const opts: DaemonModeOptions = {
      projectRoot,
      concurrency: 1,
      ensureFresh: async () => {},
      exitProcess: () => {}, // no-op exit
    };

    await runDaemonMode(opts);

    // Verify log line appears
    const logText = logs.join('\n');
    expect(logText).toContain('another daemon is already running');

    // Cleanup
    console.log = originalConsoleLog;
    holdLockSpy.mockRestore();
  });
});
