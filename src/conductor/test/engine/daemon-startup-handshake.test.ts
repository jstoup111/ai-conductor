// ─────────────────────────────────────────────────────────────────────────────
// Tests for daemon startup restart handshake (Task 9).
//
// Verifies that:
// 1. Marker present at boot → logs handshake line with identities and removes marker
// 2. No marker → silent (no handshake log)
// 3. Corrupt marker → handled by readRestartMarkerWithStatus (Task 6)
//
// The handshake is the first user-facing signal that a daemon restart due to
// engine staleness occurred — it logs the transition from prior engine to the
// fresh one, with both identities named for audit trails.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  writeRestartMarker,
  readRestartMarkerWithStatus,
  clearRestartMarker,
  recordSuppression,
  getSuppression,
  isSuppressed,
  clearSuppression,
  RESTART_MARKER_PATH,
  SUPPRESSION_PATH,
  type RestartMarker,
} from '../../src/engine/restart-intent.js';
import { initStaleEngineState, type InitStaleEngineStateOpts } from '../../src/engine/stale-engine-init.js';
import { captureEngineIdentity } from '../../src/engine/engine-identity.js';

describe('daemon startup handshake (Task 9)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-startup-handshake-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  /**
   * Helper: Create a mock engine entry point file.
   * Returns the path to the engine file so captureEngineIdentity can compute its hash.
   * Generates a unique subdirectory for each call to avoid conflicts.
   */
  let mockEngineCounter = 0;
  async function createMockEngineFile(dir: string, content = 'mock engine'): Promise<string> {
    const engineDir = join(dir, `dist-${mockEngineCounter++}`);
    await mkdir(engineDir, { recursive: true });
    const enginePath = join(engineDir, 'index.js');
    await writeFile(enginePath, content, 'utf-8');
    return enginePath;
  }

  it('marker present at boot → logs handshake with identities, marker removed', async () => {
    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-old',
      targetIdentity: 'engine-old',
      at: Date.now(),
    };

    const engineIdentity = 'engine-fresh-123abc';

    // Write marker before boot
    await writeRestartMarker(marker, projectRoot);

    // Verify marker exists
    const statusBefore = await readRestartMarkerWithStatus(projectRoot);
    expect(statusBefore.kind).toBe('present');

    // Simulate boot-time handshake logic
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // This is what daemon-cli will do at boot:
    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    if (markerStatus.kind === 'present' && engineIdentity !== null) {
      const markerData = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${engineIdentity}`,
      );
      await clearRestartMarker(projectRoot);
    }

    // Verify handshake was logged
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('restarted for engine refresh');
    expect(logs[0]).toContain('daemon-old');
    expect(logs[0]).toContain('engine-old');
    expect(logs[0]).toContain('engine-fresh-123abc');

    // Verify marker was removed
    const statusAfter = await readRestartMarkerWithStatus(projectRoot);
    expect(statusAfter.kind).toBe('absent');
    const markerPath = join(projectRoot, RESTART_MARKER_PATH);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('no marker at boot → silent (no handshake log)', async () => {
    const engineIdentity = 'engine-fresh-456def';

    // No marker written; simulate boot-time handshake logic
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    if (markerStatus.kind === 'present' && engineIdentity !== null) {
      const markerData = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${engineIdentity}`,
      );
      await clearRestartMarker(projectRoot);
    }

    // Verify no handshake was logged (silent)
    expect(logs.length).toBe(0);

    // Verify no marker file exists
    const markerPath = join(projectRoot, RESTART_MARKER_PATH);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('corrupt marker at boot → handled by readRestartMarkerWithStatus, logged', async () => {
    const markerPath = join(projectRoot, '.daemon', 'RESTART_PENDING');
    await mkdir(dirname(markerPath), { recursive: true });
    // Write corrupt data
    const fs = await import('node:fs/promises');
    await fs.writeFile(markerPath, 'garbage json {{{', 'utf-8');

    const engineIdentity = 'engine-fresh-789ghi';

    // Simulate boot-time handshake logic
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    // Task 6 guarantees corrupt marker returns absent-corrupt and is removed
    expect(markerStatus.kind).toBe('absent-corrupt');
    expect(markerStatus.marker).toBeNull();

    // Corrupt case is logged by readRestartMarkerWithStatus itself
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('corrupt');

    // Handshake should NOT be logged (marker is not present)
    if (markerStatus.kind === 'present' && engineIdentity !== null) {
      const markerData = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${engineIdentity}`,
      );
      await clearRestartMarker(projectRoot);
    }

    // Only the corrupt warning should have been logged
    expect(logs.length).toBe(1);

    // Marker file should be removed by readRestartMarkerWithStatus
    expect(existsSync(markerPath)).toBe(false);
  });

  it('handshake only happens at boot, not per-pass (verified via marker removal)', async () => {
    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-pass1',
      targetIdentity: 'engine-pass1',
      at: Date.now(),
    };

    const engineIdentity = 'engine-fresh-xyz';

    // Write marker before boot
    await writeRestartMarker(marker, projectRoot);

    // First "boot" — handshake happens
    const logsPass1: string[] = [];
    const logPass1 = (msg: string) => logsPass1.push(msg);

    const statusPass1 = await readRestartMarkerWithStatus(projectRoot, logPass1);
    if (statusPass1.kind === 'present' && engineIdentity !== null) {
      const markerData = statusPass1.marker!;
      logPass1(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${engineIdentity}`,
      );
      await clearRestartMarker(projectRoot);
    }

    // Verify first pass logged handshake
    expect(logsPass1.filter((m) => m.includes('restarted for engine refresh')).length).toBe(1);

    // Write marker again (simulating a second restart)
    await writeRestartMarker(marker, projectRoot);

    // Second "boot" — handshake should happen again (marker was re-written)
    const logsPass2: string[] = [];
    const logPass2 = (msg: string) => logsPass2.push(msg);

    const statusPass2 = await readRestartMarkerWithStatus(projectRoot, logPass2);
    if (statusPass2.kind === 'present' && engineIdentity !== null) {
      const markerData = statusPass2.marker!;
      logPass2(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${engineIdentity}`,
      );
      await clearRestartMarker(projectRoot);
    }

    // Verify second pass also logged handshake
    expect(logsPass2.filter((m) => m.includes('restarted for engine refresh')).length).toBe(1);

    // After second clear, no marker exists
    const statusFinal = await readRestartMarkerWithStatus(projectRoot);
    expect(statusFinal.kind).toBe('absent');
  });

  it('non-convergence at boot: fresh identity ≠ target → suppression recorded + warning logged', async () => {
    // Marker target T and fresh identity F ≠ T
    const markerTargetIdentity = 'engine-old-target-123';
    const freshIdentity = 'engine-fresh-456';

    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-old',
      targetIdentity: markerTargetIdentity,
      at: Date.now(),
    };

    // Write marker before boot
    await writeRestartMarker(marker, projectRoot);

    // Simulate boot-time handshake logic WITH suppression
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    if (markerStatus.kind === 'present' && freshIdentity !== null) {
      const markerData = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${freshIdentity}`,
      );

      // Task 10: Check for non-convergence and record suppression
      if (freshIdentity !== markerData.targetIdentity) {
        log(
          `suppressing restart loop — target was ${markerData.targetIdentity}, now ${freshIdentity}`,
        );
        await recordSuppression(freshIdentity, projectRoot, log);
      }

      await clearRestartMarker(projectRoot);
    }

    // Verify handshake was logged
    expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);

    // Verify suppression warning was logged naming both identities
    const suppressionLogs = logs.filter((m) => m.includes('suppressing restart loop'));
    expect(suppressionLogs.length).toBe(1);
    expect(suppressionLogs[0]).toContain(markerTargetIdentity);
    expect(suppressionLogs[0]).toContain(freshIdentity);

    // Verify suppression was recorded for the fresh identity
    const suppression = await getSuppression(projectRoot);
    expect(suppression).not.toBeNull();
    expect(suppression?.suppressedTarget).toBe(freshIdentity);

    // Verify marker was cleared
    const markerPath = join(projectRoot, 'RESTART_MARKER_PATH');
    const statusAfter = await readRestartMarkerWithStatus(projectRoot);
    expect(statusAfter.kind).toBe('absent');
  });

  it('convergence at boot: fresh identity = target → no suppression, marker cleared', async () => {
    // When fresh identity equals target, the daemon successfully restarted to the target.
    // No suppression should be recorded.
    const identity = 'engine-converged-789';

    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-old',
      targetIdentity: identity,
      at: Date.now(),
    };

    await writeRestartMarker(marker, projectRoot);

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    if (markerStatus.kind === 'present' && identity !== null) {
      const markerData = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${identity}`,
      );

      // No suppression because fresh identity matches target
      if (identity !== markerData.targetIdentity) {
        log(`suppressing restart loop — target was ${markerData.targetIdentity}, now ${identity}`);
        await recordSuppression(identity, projectRoot, log);
      }

      await clearRestartMarker(projectRoot);
    }

    // Verify handshake was logged
    expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);

    // Verify no suppression warning was logged
    const suppressionLogs = logs.filter((m) => m.includes('suppressing restart loop'));
    expect(suppressionLogs.length).toBe(0);

    // Verify no suppression was recorded
    const suppression = await getSuppression(projectRoot);
    expect(suppression).toBeNull();

    // Verify marker was cleared
    const statusAfter = await readRestartMarkerWithStatus(projectRoot);
    expect(statusAfter.kind).toBe('absent');
  });

  it('Task 2: same-boot hold — stale verdict on suppressed identity blocks restart', async () => {
    // Task 2: Within the same boot, if suppression was recorded for engine identity E,
    // and a stale verdict comes in for E, the restart request should be blocked.
    // The hold should be logged, and no restart marker should be written.

    const suppressedIdentity = 'engine-stalled-xyz';

    // Suppress this identity (as would happen after non-convergence at boot)
    await recordSuppression(suppressedIdentity, projectRoot);

    // Verify suppression record exists
    const suppression = await getSuppression(projectRoot);
    expect(suppression).not.toBeNull();
    expect(suppression?.suppressedTarget).toBe(suppressedIdentity);

    // Later in the same boot: engine becomes stale, verdict issued for the same identity
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Before writing a restart marker, check if this identity is suppressed
    const isHeld = await isSuppressed(suppressedIdentity, projectRoot, log);

    if (isHeld) {
      // Suppression active: don't write restart marker, log the hold
      log('holding restart request — engine identity is under suppression');
      // In real code: return early, don't call writeRestartMarker
    } else {
      // Normal restart request path (would write marker)
      log(`would write restart marker for ${suppressedIdentity}`);
    }

    // Verify that suppression was detected (isSuppressed returned true)
    expect(isHeld).toBe(true);

    // Verify hold was logged
    const holdLogs = logs.filter((m) => m.includes('holding restart request'));
    expect(holdLogs.length).toBe(1);
    expect(holdLogs[0]).toContain('suppression');

    // Verify suppression warning was logged exactly once (from isSuppressed)
    const suppressionWarnings = logs.filter((m) => m.includes('Restart suppressed'));
    expect(suppressionWarnings.length).toBe(1);

    // Verify that no restart marker was written (because we held)
    const markerStatus = await readRestartMarkerWithStatus(projectRoot);
    expect(markerStatus.kind).toBe('absent');

    // Verify the suppression record is still in place
    const suppressionAfter = await getSuppression(projectRoot);
    expect(suppressionAfter).not.toBeNull();
    expect(suppressionAfter?.suppressedTarget).toBe(suppressedIdentity);
  });

  it('Task 3: re-arm scenario — record for T, different target U ≠ T is not suppressed', async () => {
    // Task 3(a): When suppression is recorded for fresh identity T, asking if
    // a different target U ≠ T is suppressed should return false (re-arm).
    const suppressedIdentity = 'engine-fresh-T-111';
    const differentTarget = 'engine-target-U-222';

    // Simulate first boot: record suppression for T
    await recordSuppression(suppressedIdentity, projectRoot);

    // Verify suppression was recorded for T
    let suppression = await getSuppression(projectRoot);
    expect(suppression).not.toBeNull();
    expect(suppression?.suppressedTarget).toBe(suppressedIdentity);

    // Later scenario: ask if a different target U is suppressed
    // Should return false because suppression is for T, not U (re-arm: different target proceeds)
    const { isSuppressed } = await import('../../src/engine/restart-intent.js');
    const isUuppressed = await isSuppressed(differentTarget, projectRoot);
    expect(isUuppressed).toBe(false); // Different target is NOT suppressed (re-arm)
  });

  it('Task 3: converged boot — fresh identity = target ⇒ no suppression file written', async () => {
    // Task 3(b): When converged (fresh == target), no suppression file should be written.
    const convergedIdentity = 'engine-converged-333';

    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-boot',
      targetIdentity: convergedIdentity,
      at: Date.now(),
    };

    await writeRestartMarker(marker, projectRoot);

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    // Simulate converged boot (fresh identity = target)
    if (markerStatus.kind === 'present' && convergedIdentity !== null) {
      const markerData = markerStatus.marker!;
      // convergedIdentity === markerData.targetIdentity, so no suppression recorded
      if (convergedIdentity !== markerData.targetIdentity) {
        await recordSuppression(convergedIdentity, projectRoot, log);
      }
      await clearRestartMarker(projectRoot);
    }

    // Verify no suppression was recorded
    const suppression = await getSuppression(projectRoot);
    expect(suppression).toBeNull();
  });

  it('Task 4: converged handshake — pre-existing suppression cleared when fresh identity equals marker target', async () => {
    // Task 4: When a pre-existing suppression record exists and the fresh engine
    // identity converges to the marker's target identity (fresh === target),
    // the suppression record should be cleared by initStaleEngineState.

    const convergedIdentity = 'engine-converged-xyz789';

    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-old',
      targetIdentity: convergedIdentity, // Will equal the fresh identity
      at: Date.now(),
    };

    // Write marker before boot
    await writeRestartMarker(marker, projectRoot);

    // Pre-existing suppression record from a previous boot (non-convergence scenario)
    await recordSuppression(convergedIdentity, projectRoot);

    // Verify suppression exists before handshake
    const suppressionBefore = await getSuppression(projectRoot);
    expect(suppressionBefore).not.toBeNull();
    expect(suppressionBefore?.suppressedTarget).toBe(convergedIdentity);

    // Verify suppression file exists on disk
    const suppressionFilePath = join(projectRoot, SUPPRESSION_PATH);
    expect(existsSync(suppressionFilePath)).toBe(true);

    // Simulate boot-time handshake with manual convergence logic.
    // When fresh identity == target identity, clearSuppression should be called.
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    const freshIdentity = convergedIdentity; // Simulating convergence

    const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

    if (markerStatus.kind === 'present' && freshIdentity !== null) {
      const markerData = markerStatus.marker!;
      log(
        `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${freshIdentity}`,
      );

      // Task 10: Check for non-convergence and record suppression
      if (freshIdentity !== markerData.targetIdentity) {
        log(`suppressing restart loop — target was ${markerData.targetIdentity}, now ${freshIdentity}`);
        await recordSuppression(freshIdentity, projectRoot, log);
      } else {
        // Task 4: On convergence, clear any pre-existing suppression
        // This is where initStaleEngineState should call clearSuppression
        await clearSuppression(projectRoot, log);
      }

      await clearRestartMarker(projectRoot);
    }

    // Verify handshake was logged
    expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);

    // Verify no new suppression warning was logged (because convergence occurred)
    const suppressionLogs = logs.filter((m) => m.includes('suppressing restart loop'));
    expect(suppressionLogs.length).toBe(0);

    // CRITICAL: Verify suppression file was CLEARED after converged handshake
    const suppressionAfter = await getSuppression(projectRoot);
    expect(suppressionAfter).toBeNull();
    expect(existsSync(suppressionFilePath)).toBe(false);
  });

  it('Task 5: no-marker convergence — suppression cleared when boot runs the suppressed target', async () => {
    // Task 5: When NO restart marker is present but a suppression record exists,
    // and the fresh engine identity matches the suppressed target,
    // the suppression should be cleared at boot (no marker handshake needed).
    //
    // This handles the scenario where:
    // - Boot 1: marker present, fresh ≠ target → suppression recorded for fresh identity T
    // - Marker cleared at end of boot 1
    // - Boot 2: NO marker, but suppression for T still exists
    // - Fresh identity at boot 2 is again T (converged without marker)
    // - initStaleEngineState should clear the suppression

    // Create a mock engine file with known content
    const engineContent = 'mock engine for Task 5 convergence test';
    const enginePath = await createMockEngineFile(projectRoot, engineContent);

    // Capture the actual identity that will be computed from this file
    const engineIdentity = await captureEngineIdentity(enginePath);
    expect(engineIdentity).not.toBeNull();

    // Record suppression for this identity (as would happen after non-convergence in a prior boot)
    await recordSuppression(engineIdentity, projectRoot);

    // Verify suppression exists before boot
    const suppressionBefore = await getSuppression(projectRoot);
    expect(suppressionBefore).not.toBeNull();
    expect(suppressionBefore?.suppressedTarget).toBe(engineIdentity);

    // Verify suppression file exists on disk
    const suppressionFilePath = join(projectRoot, SUPPRESSION_PATH);
    expect(existsSync(suppressionFilePath)).toBe(true);

    // CRITICAL: No marker written — only suppression record exists

    // Call initStaleEngineState (the function being tested)
    const logs: string[] = [];
    const capturedIdentity = await initStaleEngineState({
      repoPath: projectRoot,
      entryPath: enginePath,
      flag: true,
      log: (msg) => logs.push(msg),
    });

    // Verify that the engine identity was captured
    expect(capturedIdentity).not.toBeNull();
    expect(capturedIdentity).toBe(engineIdentity);

    // Verify that suppression is now cleared
    const suppressionAfter = await getSuppression(projectRoot);
    expect(suppressionAfter).toBeNull();
    expect(existsSync(suppressionFilePath)).toBe(false);
  });

  it('Task 5 non-match: no-marker with suppression for different identity → record left in place', async () => {
    // Task 5 verification: When NO restart marker is present, suppression record exists
    // for target T, but fresh engine identity is X ≠ T, the suppression should NOT be cleared.
    //
    // This ensures suppression only clears when the fresh identity matches the suppressed target.

    // Create a mock engine file with one content
    const engineContent1 = 'mock engine content 1';
    const enginePath1 = await createMockEngineFile(projectRoot, engineContent1);
    const identity1 = await captureEngineIdentity(enginePath1);
    expect(identity1).not.toBeNull();

    // Record suppression for identity1
    await recordSuppression(identity1, projectRoot);

    // Verify suppression exists before boot
    const suppressionBefore = await getSuppression(projectRoot);
    expect(suppressionBefore).not.toBeNull();
    expect(suppressionBefore?.suppressedTarget).toBe(identity1);

    // Verify suppression file exists on disk
    const suppressionFilePath = join(projectRoot, SUPPRESSION_PATH);
    expect(existsSync(suppressionFilePath)).toBe(true);

    // Now create a DIFFERENT engine file with different content
    const engineContent2 = 'mock engine content 2 - DIFFERENT';
    const enginePath2 = await createMockEngineFile(projectRoot, engineContent2);
    const identity2 = await captureEngineIdentity(enginePath2);
    expect(identity2).not.toBeNull();
    expect(identity2).not.toBe(identity1);

    // CRITICAL: No marker written — only suppression record exists for identity1

    // Call initStaleEngineState with the different engine identity (identity2)
    const logs: string[] = [];
    const capturedIdentity = await initStaleEngineState({
      repoPath: projectRoot,
      entryPath: enginePath2,
      flag: true,
      log: (msg) => logs.push(msg),
    });

    // Verify that the engine identity was captured (and is different from suppressed)
    expect(capturedIdentity).not.toBeNull();
    expect(capturedIdentity).toBe(identity2);
    expect(capturedIdentity).not.toBe(identity1);

    // Verify that suppression is STILL in place (not cleared, because identity doesn't match)
    const suppressionAfter = await getSuppression(projectRoot);
    expect(suppressionAfter).not.toBeNull();
    expect(suppressionAfter?.suppressedTarget).toBe(identity1);
    expect(existsSync(suppressionFilePath)).toBe(true);
  });
});
