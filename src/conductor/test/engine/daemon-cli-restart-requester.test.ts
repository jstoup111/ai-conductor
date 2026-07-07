/**
 * Tests for RestartRequester — marker → release → exit ordering (Task 14).
 *
 * Verifies:
 * 1. Invocation order: exactly write-marker, release-lock, exit(0) in success path
 * 2. A throw during marker-write still reaches the existing exit backstop
 * 3. Lock is not stranded (releaseSync called via backstop path on error)
 * 4. Uses injected lock + exit fakes in tests for verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

describe('Task 14 — RestartRequester: marker → release → exit ordering', () => {
  let daemonDir: string;

  beforeEach(async () => {
    daemonDir = await mkdtemp(join(tmpdir(), 'restart-requester-'));
  });

  afterEach(async () => {
    await rm(daemonDir, { recursive: true, force: true });
  });

  /**
   * Test: happy path — write marker, release lock, exit(0) in order
   */
  it('happy path: write-marker → release-lock → exit(0)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];
    const mockLock = {
      releaseSync: () => {
        callOrder.push('release');
      },
    };

    // For happy path, process.exit(0) signals the end of execution
    const mockProcess = {
      exit: (code: number) => {
        callOrder.push(`exit(${code})`);
        throw new Error(`process.exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected: process.exit() breaks control flow
    }

    // In happy path: write marker → release lock → exit(0)
    // We should NOT see the catch block executing (no second release/exit(1))
    expect(callOrder).toEqual(['release', 'exit(0)']);

    // Verify marker was written
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(true);

    const markerContent = JSON.parse(await readFile(markerPath, 'utf-8'));
    expect(markerContent.reason).toBe('stale-engine');
    expect(markerContent.fromIdentity).toBe('daemon-id-123');
    expect(markerContent.targetIdentity).toBe('engine-id-456');
    expect(typeof markerContent.at).toBe('number');
  });

  /**
   * Test: error during marker-write is caught → release-lock → exit(1)
   *
   * This test manually patches writeRestartMarker using vi.spyOn to simulate a failure.
   */
  it('error path: marker write fails → backstop releases-lock → exit(1)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');
    const restartIntentModule = await import('../../src/engine/restart-intent.js');

    const callOrder: string[] = [];
    const mockLock = {
      releaseSync: () => {
        callOrder.push('release');
      },
    };

    const mockProcess = {
      exit: (code: number) => {
        callOrder.push(`exit(${code})`);
        throw new Error(`process.exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    // Spy on writeRestartMarker and make it throw
    let writeCallCount = 0;
    const writeSpy = vi.spyOn(restartIntentModule, 'writeRestartMarker').mockImplementation(
      async () => {
        writeCallCount++;
        throw new Error('Simulated marker write failure');
      },
    );

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected: process.exit() throws
    }

    // Error path: on marker write failure, catch block runs
    // Expect: release → exit(1)
    expect(callOrder).toEqual(['release', 'exit(1)']);

    // Verify writeRestartMarker was attempted
    expect(writeCallCount).toBe(1);

    // Clean up spy
    writeSpy.mockRestore();
  });

  /**
   * Test: lock is released exactly once in success path
   */
  it('lock is released exactly once in success path', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    let releaseSyncCallCount = 0;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCallCount++;
      },
    };

    const mockProcess = {
      exit: () => {
        throw new Error('process.exit');
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected
    }

    // Lock should be released exactly once in success path
    expect(releaseSyncCallCount).toBe(1);
  });

  /**
   * Test: lock is released exactly once in error path
   */
  it('lock is released exactly once in error path', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');
    const restartIntentModule = await import('../../src/engine/restart-intent.js');

    let releaseSyncCallCount = 0;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCallCount++;
      },
    };

    const mockProcess = {
      exit: () => {
        throw new Error('process.exit');
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    // Spy on writeRestartMarker to make it throw
    const writeSpy = vi.spyOn(restartIntentModule, 'writeRestartMarker').mockImplementation(
      async () => {
        throw new Error('Marker write failed');
      },
    );

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected
    }

    // Lock should be released exactly once in error path (by backstop)
    expect(releaseSyncCallCount).toBe(1);

    // Clean up spy
    writeSpy.mockRestore();
  });

  /**
   * Test: marker contains all required fields
   */
  it('marker contains all required fields: reason, fromIdentity, targetIdentity, at', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const mockLock = {
      releaseSync: () => {},
    };

    const mockProcess = {
      exit: () => {
        throw new Error('process.exit');
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: 'from-abc',
        targetIdentity: 'to-xyz',
      });
    } catch (e) {
      // Expected
    }

    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    const markerContent = JSON.parse(await readFile(markerPath, 'utf-8'));

    expect(markerContent).toHaveProperty('reason');
    expect(markerContent).toHaveProperty('fromIdentity');
    expect(markerContent).toHaveProperty('targetIdentity');
    expect(markerContent).toHaveProperty('at');
    expect(markerContent.reason).toBe('stale-engine');
    expect(markerContent.fromIdentity).toBe('from-abc');
    expect(markerContent.targetIdentity).toBe('to-xyz');
    expect(typeof markerContent.at).toBe('number');
  });

  /**
   * Test: null identities are preserved in marker
   */
  it('null identities are preserved in marker', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const mockLock = {
      releaseSync: () => {},
    };

    const mockProcess = {
      exit: () => {
        throw new Error('process.exit');
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: null,
        targetIdentity: null,
      });
    } catch (e) {
      // Expected
    }

    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    const markerContent = JSON.parse(await readFile(markerPath, 'utf-8'));

    expect(markerContent.fromIdentity).toBeNull();
    expect(markerContent.targetIdentity).toBeNull();
  });

  /**
   * Test: session-hosted mode with injected relink + triggerSelfRestart
   *
   * Session-hosted flow:
   * 1. Call relink
   * 2. Write underscore marker
   * 3. Call triggerSelfRestart
   * 4. Never call lock.releaseSync() or process.exit()
   *
   * Verifies exact call order via spy call counts and order
   *
   * Task 10 (non-autonomy): The hyphen marker (.daemon/RESTART-PENDING) is for CLI
   * `daemon restart` queued restarts and must NEVER be touched by the stale-engine path.
   * This assertion verifies that the hyphen marker is never created or modified.
   */
  it('session-hosted mode: relink → marker → triggerSelfRestart (no lock release, no exit)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
    });

    const mockTriggerSelfRestart = vi.fn(async () => {
      callOrder.push('triggerSelfRestart');
    });

    let releaseSyncCalled = false;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCalled = true;
        callOrder.push('release');
      },
    };

    let exitCalled = false;
    const mockProcess = {
      exit: (code: number) => {
        exitCalled = true;
        callOrder.push(`exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    // Task 10: Ensure hyphen marker doesn't exist before the test
    const hyphensMarkerPath = join(daemonDir, '.daemon', 'RESTART-PENDING');
    // Clean up if it exists (should not on fresh tmpdir, but be explicit)
    try {
      await rm(hyphensMarkerPath, { force: true });
    } catch {
      // Ignore
    }

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
      triggerSelfRestart: mockTriggerSelfRestart,
    });

    // Session-hosted mode should NOT throw or call exit
    await requester({
      fromIdentity: 'daemon-id-123',
      targetIdentity: 'engine-id-456',
    });

    // Verify call order: relink → marker → triggerSelfRestart
    expect(callOrder).toEqual(['relink', 'triggerSelfRestart']);

    // Verify lock and exit were NOT called
    expect(releaseSyncCalled).toBe(false);
    expect(exitCalled).toBe(false);

    // Verify underscore marker was written (stale-engine marker)
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(true);

    const markerContent = JSON.parse(await readFile(markerPath, 'utf-8'));
    expect(markerContent.reason).toBe('stale-engine');
    expect(markerContent.fromIdentity).toBe('daemon-id-123');
    expect(markerContent.targetIdentity).toBe('engine-id-456');

    // Task 10 (non-autonomy): Verify hyphen marker was NEVER created/touched
    // The hyphen marker is for CLI `daemon restart` queued restarts, not stale-engine
    expect(existsSync(hyphensMarkerPath)).toBe(false);
  });

  /**
   * Test: session-hosted mode without triggerSelfRestart but with relink
   *
   * When only relink is provided (no triggerSelfRestart), headless behavior applies:
   * 1. Call relink
   * 2. Write marker
   * 3. Release lock
   * 4. Exit(0)
   */
  it('headless with relink: relink → marker → release → exit(0)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
    });

    const mockLock = {
      releaseSync: () => {
        callOrder.push('release');
      },
    };

    const mockProcess = {
      exit: (code: number) => {
        callOrder.push(`exit(${code})`);
        throw new Error(`process.exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    // Deps with relink but no triggerSelfRestart
    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
    });

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected: process.exit() breaks control flow
    }

    // Verify call order: relink → release → exit(0)
    expect(callOrder).toEqual(['relink', 'release', 'exit(0)']);

    // Verify marker was written
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(true);
  });

  /**
   * Test: backward compatibility — no deps provided (legacy behavior)
   *
   * When no deps are provided, the function should still work with the old flow:
   * write marker → release → exit(0)
   */
  it('backward compatibility: no deps provided → marker → release → exit(0)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];

    const mockLock = {
      releaseSync: () => {
        callOrder.push('release');
      },
    };

    const mockProcess = {
      exit: (code: number) => {
        callOrder.push(`exit(${code})`);
        throw new Error(`process.exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = () => {};

    // No deps provided
    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess);

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected: process.exit() throws
    }

    // Verify call order: release → exit(0)
    expect(callOrder).toEqual(['release', 'exit(0)']);
  });

  /**
   * Task 5 (RED): relink throws in session-hosted mode → abort-alive
   *
   * When relink throws during session-hosted restart:
   * 1. No marker file is created
   * 2. No trigger is called
   * 3. No lock release, no exit
   * 4. Error is logged
   * 5. Function returns normally (not throw, not exit)
   */
  it('Task 5 — relink throws in session-hosted: abort-alive (no marker, no trigger, no lock release/exit)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];
    const logs: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
      throw new Error('InstallStaleError: relink failed');
    });

    const mockTriggerSelfRestart = vi.fn(async () => {
      callOrder.push('triggerSelfRestart');
    });

    let releaseSyncCalled = false;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCalled = true;
        callOrder.push('release');
      },
    };

    let exitCalled = false;
    const mockProcess = {
      exit: (code: number) => {
        exitCalled = true;
        callOrder.push(`exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = (msg: string) => {
      logs.push(msg);
    };

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
      triggerSelfRestart: mockTriggerSelfRestart,
    });

    // Should NOT throw or call exit
    await requester({
      fromIdentity: 'daemon-id-123',
      targetIdentity: 'engine-id-456',
    });

    // Verify relink was called, but trigger was NOT called
    expect(callOrder).toEqual(['relink']);

    // Verify lock release and exit were NOT called
    expect(releaseSyncCalled).toBe(false);
    expect(exitCalled).toBe(false);

    // Verify marker was NOT created
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(false);

    // Verify error was logged (at least one log mentioning the error)
    expect(logs.length).toBeGreaterThan(0);
    const errorLogged = logs.some((msg) => msg.includes('relink') || msg.includes('failed'));
    expect(errorLogged).toBe(true);
  });

  /**
   * Task 5: relink throws in headless mode → keep existing behavior (release + exit(1))
   *
   * When relink throws during headless restart:
   * 1. No marker file is created (relink error prevents us getting there)
   * 2. Lock IS released
   * 3. process.exit(1) IS called
   * 4. Error is logged
   */
  it('Task 5 — relink throws in headless: release → exit(1)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];
    const logs: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
      throw new Error('InstallStaleError: relink failed');
    });

    let releaseSyncCalled = false;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCalled = true;
        callOrder.push('release');
      },
    };

    const mockProcess = {
      exit: (code: number) => {
        callOrder.push(`exit(${code})`);
        throw new Error(`process.exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = (msg: string) => {
      logs.push(msg);
    };

    // Headless mode: relink provided but NO triggerSelfRestart
    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
    });

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected: process.exit(1) throws
    }

    // Verify call order: relink → release → exit(1)
    expect(callOrder).toEqual(['relink', 'release', 'exit(1)']);

    // Verify marker was NOT created
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(false);

    // Verify error was logged
    expect(logs.length).toBeGreaterThan(0);
  });

  /**
   * Task 7: respawn throws in session-hosted mode → stay alive, marker remains
   *
   * When triggerSelfRestart throws during session-hosted restart:
   * 1. Marker file WAS created before the trigger was attempted (still present)
   * 2. No lock release (lock.releaseSync() NOT called)
   * 3. No exit (process.exit() NOT called)
   * 4. Error is logged
   * 5. Function returns normally (doesn't throw or exit)
   * 6. Marker is preserved for retry at next idle boundary
   */
  it('Task 7 — respawn throws in session-hosted: stay alive, marker remains (consume-once at next boot)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');

    const callOrder: string[] = [];
    const logs: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
    });

    const mockTriggerSelfRestart = vi.fn(async () => {
      callOrder.push('triggerSelfRestart');
      throw new Error('respawn failed: supervisor not ready');
    });

    let releaseSyncCalled = false;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCalled = true;
        callOrder.push('release');
      },
    };

    let exitCalled = false;
    const mockProcess = {
      exit: (code: number) => {
        exitCalled = true;
        callOrder.push(`exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = (msg: string) => {
      logs.push(msg);
    };

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
      triggerSelfRestart: mockTriggerSelfRestart,
    });

    // Session-hosted mode should NOT throw or call exit, even if trigger fails
    await requester({
      fromIdentity: 'daemon-id-123',
      targetIdentity: 'engine-id-456',
    });

    // Verify relink and trigger were called
    expect(callOrder).toEqual(['relink', 'triggerSelfRestart']);

    // Verify lock release and exit were NOT called
    expect(releaseSyncCalled).toBe(false);
    expect(exitCalled).toBe(false);

    // Verify marker file was created and still present (not cleaned up on error)
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(true);

    const markerContent = JSON.parse(await readFile(markerPath, 'utf-8'));
    expect(markerContent.reason).toBe('stale-engine');
    expect(markerContent.fromIdentity).toBe('daemon-id-123');
    expect(markerContent.targetIdentity).toBe('engine-id-456');

    // Verify error was logged
    expect(logs.length).toBeGreaterThan(0);
    const errorLogged = logs.some((msg) =>
      msg.includes('respawn') || msg.includes('failed') || msg.includes('trigger')
    );
    expect(errorLogged).toBe(true);
  });

  /**
   * Task 6 (RED): marker-write throws in session-hosted mode → abort-alive
   *
   * When marker-write throws during session-hosted restart:
   * 1. triggerSelfRestart is NOT called
   * 2. No lock release (lock.releaseSync() NOT called)
   * 3. No exit (process.exit() NOT called)
   * 4. Error is logged
   * 5. Function returns normally (doesn't throw)
   * 6. Remain alive so marker can be retried on next idle boundary
   */
  it('Task 6 — marker-write throws in session-hosted: abort-alive (no trigger, no lock release/exit)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');
    const restartIntentModule = await import('../../src/engine/restart-intent.js');

    const callOrder: string[] = [];
    const logMessages: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
    });

    const mockTriggerSelfRestart = vi.fn(async () => {
      callOrder.push('triggerSelfRestart');
    });

    let releaseSyncCalled = false;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCalled = true;
        callOrder.push('release');
      },
    };

    let exitCalled = false;
    const mockProcess = {
      exit: (code: number) => {
        exitCalled = true;
        callOrder.push(`exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = (msg: string) => {
      logMessages.push(msg);
    };

    // Spy on writeRestartMarker and make it throw
    const writeSpy = vi.spyOn(restartIntentModule, 'writeRestartMarker').mockImplementation(
      async () => {
        throw new Error('Marker write failed: EACCES permission denied');
      },
    );

    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
      triggerSelfRestart: mockTriggerSelfRestart,
    });

    // Session-hosted mode should NOT throw when marker-write fails
    await requester({
      fromIdentity: 'daemon-id-123',
      targetIdentity: 'engine-id-456',
    });

    // Verify relink was called, but trigger was NOT called
    expect(callOrder).toEqual(['relink']);

    // Verify triggerSelfRestart was NOT called
    expect(mockTriggerSelfRestart).not.toHaveBeenCalled();

    // Verify lock.releaseSync() was NOT called
    expect(releaseSyncCalled).toBe(false);

    // Verify process.exit() was NOT called
    expect(exitCalled).toBe(false);

    // Verify error was logged
    expect(logMessages.length).toBeGreaterThan(0);
    const errorLogged = logMessages.some((msg) =>
      msg.includes('marker write failed') || msg.includes('permission') || msg.includes('EACCES')
    );
    expect(errorLogged).toBe(true);

    // Verify marker was NOT created (due to the write failure)
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(false);

    // Clean up spy
    writeSpy.mockRestore();
  });

  /**
   * Task 6: marker-write throws in headless mode → release + exit(1) (backward compatibility)
   *
   * When marker-write throws during headless restart:
   * 1. Lock IS released
   * 2. process.exit(1) IS called
   * 3. Error is logged
   * 4. Backward compatibility: existing test still passes
   */
  it('Task 6 — marker-write throws in headless: release → exit(1) (backward compatibility)', async () => {
    const { createRestartRequester } = await import('../../src/daemon-cli.js');
    const restartIntentModule = await import('../../src/engine/restart-intent.js');

    const callOrder: string[] = [];
    const logMessages: string[] = [];

    const mockRelink = vi.fn(async () => {
      callOrder.push('relink');
    });

    let releaseSyncCalled = false;
    const mockLock = {
      releaseSync: () => {
        releaseSyncCalled = true;
        callOrder.push('release');
      },
    };

    const mockProcess = {
      exit: (code: number) => {
        callOrder.push(`exit(${code})`);
        throw new Error(`process.exit(${code})`);
      },
    } as unknown as NodeJS.Process;

    const mockLog = (msg: string) => {
      logMessages.push(msg);
    };

    // Spy on writeRestartMarker and make it throw
    const writeSpy = vi.spyOn(restartIntentModule, 'writeRestartMarker').mockImplementation(
      async () => {
        throw new Error('Marker write failed: fs quota exceeded');
      },
    );

    // Headless mode: relink provided but NO triggerSelfRestart
    const requester = createRestartRequester(daemonDir, mockLog, mockLock, mockProcess, {
      relink: mockRelink,
    });

    try {
      await requester({
        fromIdentity: 'daemon-id-123',
        targetIdentity: 'engine-id-456',
      });
    } catch (e) {
      // Expected: process.exit(1) throws
    }

    // Verify call order: relink → release → exit(1)
    expect(callOrder).toEqual(['relink', 'release', 'exit(1)']);

    // Verify lock release was called
    expect(releaseSyncCalled).toBe(true);

    // Verify error was logged
    expect(logMessages.length).toBeGreaterThan(0);
    const errorLogged = logMessages.some((msg) =>
      msg.includes('Marker write failed') || msg.includes('quota')
    );
    expect(errorLogged).toBe(true);

    // Verify marker was NOT created (due to the write failure)
    const markerPath = join(daemonDir, '.daemon', 'RESTART_PENDING');
    expect(existsSync(markerPath)).toBe(false);

    // Clean up spy
    writeSpy.mockRestore();
  });
});
