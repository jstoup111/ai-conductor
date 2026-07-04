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
});
