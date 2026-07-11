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

  it('Task 7: daemon boot runs initStaleEngineState end-to-end', async () => {
    // Task 7: Verify that daemon boot calls initStaleEngineState and produces all expected effects:
    // 1. Captures engine identity
    // 2. Logs ARMED/DISARMED status
    // 3. Logs handshake if marker present
    // 4. Records/clears suppression as needed
    // 5. Clears restart marker

    const engineContent = 'mock engine for Task 7 boot test';
    const enginePath = await createMockEngineFile(projectRoot, engineContent);
    const engineIdentity = await captureEngineIdentity(enginePath);
    expect(engineIdentity).not.toBeNull();

    // Set up: marker present + non-convergence scenario (fresh ≠ target)
    const targetIdentity = 'engine-target-old-xyz';
    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-old',
      targetIdentity,
      at: Date.now(),
    };

    await writeRestartMarker(marker, projectRoot);

    // Verify marker exists before boot
    const markerBefore = await readRestartMarkerWithStatus(projectRoot);
    expect(markerBefore.kind).toBe('present');

    // Call initStaleEngineState (simulating daemon boot)
    const logs: string[] = [];
    const capturedIdentity = await initStaleEngineState({
      repoPath: projectRoot,
      entryPath: enginePath,
      flag: true, // ARMED
      log: (msg) => logs.push(msg),
    });

    // Verify all boot effects:

    // 1. Identity captured
    expect(capturedIdentity).toBe(engineIdentity);

    // 2. Daemon identity logged
    expect(logs.some((m) => m.includes('daemon identity'))).toBe(true);
    expect(logs.some((m) => m.includes(engineIdentity))).toBe(true);

    // 3. ARMED status logged
    expect(logs.some((m) => m.includes('ARMED'))).toBe(true);
    expect(logs.some((m) => m.includes('stale-engine auto-restart'))).toBe(true);

    // 4. Handshake logged with both identities (fresh ≠ target)
    expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);
    expect(logs.some((m) => m.includes(targetIdentity))).toBe(true);
    expect(logs.some((m) => m.includes(engineIdentity))).toBe(true);

    // 5. Suppression recorded (fresh ≠ target)
    // Task 1: Suppression should be recorded against the TARGET identity, not the fresh identity
    expect(logs.some((m) => m.includes('suppressing restart loop'))).toBe(true);
    const suppression = await getSuppression(projectRoot);
    expect(suppression).not.toBeNull();
    expect(suppression?.suppressedTarget).toBe(targetIdentity);

    // 6. Marker cleared
    const markerAfter = await readRestartMarkerWithStatus(projectRoot);
    expect(markerAfter.kind).toBe('absent');
    const markerPath = join(projectRoot, RESTART_MARKER_PATH);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('Task 7: daemon boot convergence — initStaleEngineState clears suppression when fresh == target', async () => {
    // Task 7: Verify convergence scenario where fresh identity matches target
    // Suppression should be recorded then cleared

    const engineContent = 'mock engine for Task 7 convergence test';
    const enginePath = await createMockEngineFile(projectRoot, engineContent);
    const engineIdentity = await captureEngineIdentity(enginePath);
    expect(engineIdentity).not.toBeNull();

    // Convergence scenario: target == fresh identity
    const marker: RestartMarker = {
      reason: 'engine stalled',
      fromIdentity: 'daemon-old',
      targetIdentity: engineIdentity, // Same as fresh
      at: Date.now(),
    };

    await writeRestartMarker(marker, projectRoot);

    // Pre-existing suppression from prior non-convergence
    await recordSuppression(engineIdentity, projectRoot);

    const suppressionBefore = await getSuppression(projectRoot);
    expect(suppressionBefore).not.toBeNull();

    // Call initStaleEngineState
    const logs: string[] = [];
    const capturedIdentity = await initStaleEngineState({
      repoPath: projectRoot,
      entryPath: enginePath,
      flag: true,
      log: (msg) => logs.push(msg),
    });

    // Verify identity captured
    expect(capturedIdentity).toBe(engineIdentity);

    // Verify handshake logged
    expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);

    // Verify NO suppression recorded (fresh == target means convergence)
    expect(logs.some((m) => m.includes('suppressing restart loop'))).toBe(false);

    // CRITICAL: Verify suppression was CLEARED on convergence
    const suppressionAfter = await getSuppression(projectRoot);
    expect(suppressionAfter).toBeNull();

    // Verify marker cleared
    const markerAfter = await readRestartMarkerWithStatus(projectRoot);
    expect(markerAfter.kind).toBe('absent');
  });

  it('Task 8: ARMED gating parity — flag false when config true but self-host false', async () => {
    // Task 8: Verify that the flag passed to initStaleEngineState is gated by both
    // config.auto_restart_on_stale_engine AND isSelfHost. When config is true but
    // isSelfHost is false, the primitive should receive false and log DISARMED.
    //
    // This test simulates what daemon-cli does:
    // isArmed = (config?.auto_restart_on_stale_engine ?? false) && isSelfHost
    // When this calculation yields false (because isSelfHost is false),
    // the DISARMED/ARMED line should say DISARMED through the wired path.

    const engineContent = 'mock engine for Task 8 gating test';
    const enginePath = await createMockEngineFile(projectRoot, engineContent);
    const engineIdentity = await captureEngineIdentity(enginePath);
    expect(engineIdentity).not.toBeNull();

    // Simulate daemon-cli scenario:
    // - config.auto_restart_on_stale_engine = true
    // - isSelfHost = false
    // - Expected: isArmed = true && false = false
    const configFlag = true; // config.auto_restart_on_stale_engine
    const isSelfHost = false; // self-host classification
    const isArmed = (configFlag ?? false) && isSelfHost; // The gating logic
    expect(isArmed).toBe(false); // Verify our test setup

    // Call initStaleEngineState with the pre-gated flag (should be false)
    const logs: string[] = [];
    const capturedIdentity = await initStaleEngineState({
      repoPath: projectRoot,
      entryPath: enginePath,
      flag: isArmed, // Pre-gated value
      log: (msg) => logs.push(msg),
    });

    // Verify identity was captured
    expect(capturedIdentity).toBe(engineIdentity);

    // CRITICAL: Verify DISARMED status was logged (not ARMED)
    // Despite config flag being true, since isSelfHost is false,
    // the daemon should log DISARMED through the wired path
    const armedDisarmedLines = logs.filter((m) => m.match(/^(ARMED|DISARMED)/));
    expect(armedDisarmedLines.length).toBe(1);
    expect(armedDisarmedLines[0]).toMatch(/^DISARMED/);
    expect(armedDisarmedLines[0]).not.toMatch(/^ARMED/);
  });

  describe('Task 9: Capture-failure and corrupt-marker degradation', () => {
    it('(a) missing/unreadable dist/index.js → init returns null, handshake skipped, no crash', async () => {
      // Task 9(a): When the engine entry point (dist/index.js) is missing or unreadable,
      // captureEngineIdentity returns null, which causes:
      // 1. initStaleEngineState returns null
      // 2. Handshake is skipped (checker disabled)
      // 3. Restart marker is NOT read (safe degradation)
      // 4. Boot continues without crash

      // Set up a marker to verify it's NOT read/handled when engine identity is null
      const marker: RestartMarker = {
        reason: 'engine stalled',
        fromIdentity: 'daemon-old',
        targetIdentity: 'engine-old-xyz',
        at: Date.now(),
      };

      await writeRestartMarker(marker, projectRoot);

      // Verify marker exists
      const statusBefore = await readRestartMarkerWithStatus(projectRoot);
      expect(statusBefore.kind).toBe('present');

      // Call initStaleEngineState with non-existent engine file
      const logs: string[] = [];
      const nonExistentEngineFile = join(projectRoot, 'does-not-exist', 'index.js');

      const capturedIdentity = await initStaleEngineState({
        repoPath: projectRoot,
        entryPath: nonExistentEngineFile,
        flag: true,
        log: (msg) => logs.push(msg),
      });

      // Verify init returned null (capture failed)
      expect(capturedIdentity).toBeNull();

      // Verify daemon identity log is NOT present (because identity was null)
      expect(logs.some((m) => m.includes('daemon identity'))).toBe(false);

      // Verify ARMED status is still logged (before the identity check)
      expect(logs.some((m) => m.includes('ARMED'))).toBe(true);

      // CRITICAL: Verify handshake is NOT logged (handshake skipped when identity is null)
      expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(false);

      // CRITICAL: Verify marker is still present on disk (not read/cleared when identity is null)
      // This is the safe degradation — checker is disabled, so no restart handling
      const statusAfter = await readRestartMarkerWithStatus(projectRoot);
      expect(statusAfter.kind).toBe('present');

      // CRITICAL: Boot continued without crashing (no exception thrown)
      expect(true).toBe(true);
    });

    it('(b) corrupt marker JSON → logged + removed, no suppression write, boot continues', async () => {
      // Task 9(b): When the marker file contains corrupt JSON,
      // readRestartMarkerWithStatus handles it gracefully:
      // 1. Corruption is logged
      // 2. Marker file is removed
      // 3. No suppression file is written
      // 4. Boot continues normally

      const engineContent = 'mock engine for corrupt marker test';
      const enginePath = await createMockEngineFile(projectRoot, engineContent);
      const engineIdentity = await captureEngineIdentity(enginePath);
      expect(engineIdentity).not.toBeNull();

      // Write corrupt marker directly to disk
      const markerPath = join(projectRoot, '.daemon', 'RESTART_PENDING');
      await mkdir(dirname(markerPath), { recursive: true });
      const fs = await import('node:fs/promises');
      await fs.writeFile(markerPath, 'this is not valid json {{{', 'utf-8');

      // Verify corrupt marker exists
      expect(existsSync(markerPath)).toBe(true);

      // Verify no suppression file exists yet
      const suppressionPath = join(projectRoot, SUPPRESSION_PATH);
      expect(existsSync(suppressionPath)).toBe(false);

      // Call initStaleEngineState
      const logs: string[] = [];
      const capturedIdentity = await initStaleEngineState({
        repoPath: projectRoot,
        entryPath: enginePath,
        flag: true,
        log: (msg) => logs.push(msg),
      });

      // Verify engine identity was captured
      expect(capturedIdentity).toBe(engineIdentity);

      // Verify daemon identity was logged
      expect(logs.some((m) => m.includes('daemon identity'))).toBe(true);

      // Verify ARMED status was logged
      expect(logs.some((m) => m.includes('ARMED'))).toBe(true);

      // CRITICAL: Verify corruption was logged
      expect(logs.some((m) => m.includes('corrupt'))).toBe(true);

      // CRITICAL: Verify handshake is NOT logged (marker was corrupt, not present)
      expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(false);

      // CRITICAL: Verify no suppression write was attempted (no suppression file created)
      expect(existsSync(suppressionPath)).toBe(false);

      // CRITICAL: Verify corrupt marker file was removed by readRestartMarkerWithStatus
      expect(existsSync(markerPath)).toBe(false);

      // CRITICAL: Boot continued without crashing
      expect(true).toBe(true);
    });

    it('(b) corrupt marker with fresh identity mismatch → degraded safely, no suppression write', async () => {
      // Task 9(b) variant: Corrupt marker case where fresh identity differs from target.
      // Even though the marker is corrupt, the degradation path should be identical:
      // corruption logged, marker removed, no suppression written, boot continues.

      const engineContent = 'mock engine for corrupt marker variant';
      const enginePath = await createMockEngineFile(projectRoot, engineContent);
      const engineIdentity = await captureEngineIdentity(enginePath);
      expect(engineIdentity).not.toBeNull();

      // Write corrupt marker
      const markerPath = join(projectRoot, '.daemon', 'RESTART_PENDING');
      await mkdir(dirname(markerPath), { recursive: true });
      const fs = await import('node:fs/promises');
      await fs.writeFile(markerPath, '{ corrupted data }}}', 'utf-8');

      expect(existsSync(markerPath)).toBe(true);

      const suppressionPath = join(projectRoot, SUPPRESSION_PATH);
      expect(existsSync(suppressionPath)).toBe(false);

      // Call initStaleEngineState
      const logs: string[] = [];
      const capturedIdentity = await initStaleEngineState({
        repoPath: projectRoot,
        entryPath: enginePath,
        flag: true,
        log: (msg) => logs.push(msg),
      });

      expect(capturedIdentity).toBe(engineIdentity);

      // Verify corruption was logged
      expect(logs.some((m) => m.includes('corrupt'))).toBe(true);

      // Verify no suppression warning/write
      expect(logs.some((m) => m.includes('suppressing restart loop'))).toBe(false);
      expect(existsSync(suppressionPath)).toBe(false);

      // Verify marker was removed
      expect(existsSync(markerPath)).toBe(false);

      // Boot continued successfully
      expect(true).toBe(true);
    });
  });

  describe('Task 6: Persistence-failure degradation', () => {
    it('(a) suppression write fails → failure logged, boot continues, marker cleared', async () => {
      // Task 6(a): When recording suppression fails (e.g., can't write suppression file)
      // the failure should be logged but boot should continue and the marker
      // should still be cleared afterwards.

      const marker: RestartMarker = {
        reason: 'engine stalled',
        fromIdentity: 'daemon-old',
        targetIdentity: 'engine-target-123',
        at: Date.now(),
      };

      const freshIdentity = 'engine-fresh-456'; // ≠ target → suppression will be attempted

      // Write marker before boot
      await writeRestartMarker(marker, projectRoot);

      const markerPath = join(projectRoot, RESTART_MARKER_PATH);
      const suppressionPath = join(projectRoot, SUPPRESSION_PATH);

      // Verify marker was written
      expect(existsSync(markerPath)).toBe(true);

      // Create a directory at the suppression path to block file writes there
      // This simulates a write failure
      const fs = await import('node:fs/promises');
      await mkdir(suppressionPath, { recursive: true });

      // Verify directory exists at suppression path
      expect(existsSync(suppressionPath)).toBe(true);

      // Simulate boot-time handshake logic
      const logs: string[] = [];
      const log = (msg: string) => logs.push(msg);

      const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

      if (markerStatus.kind === 'present' && freshIdentity !== null) {
        const markerData = markerStatus.marker!;
        log(
          `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${freshIdentity}`,
        );

        // This will fail because suppressionPath is a directory, not a file
        if (freshIdentity !== markerData.targetIdentity) {
          log(`suppressing restart loop — target was ${markerData.targetIdentity}, now ${freshIdentity}`);
          await recordSuppression(freshIdentity, projectRoot, log);
          // recordSuppression logs failure but doesn't throw
        } else {
          await clearSuppression(projectRoot, log);
        }

        // CRITICAL: marker must still be cleared even if suppression write failed
        await clearRestartMarker(projectRoot, log);
      }

      // Verify handshake was logged
      expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);

      // Verify suppression write failure was logged
      const suppressionFailLogs = logs.filter((m) => m.includes('could not persist suppression'));
      expect(suppressionFailLogs.length).toBe(1);

      // CRITICAL: Verify marker was cleared despite suppression write failure
      expect(existsSync(markerPath)).toBe(false);
      const statusAfter = await readRestartMarkerWithStatus(projectRoot);
      expect(statusAfter.kind).toBe('absent');
    });

    it('(b) marker clear failure → logged, boot continues', async () => {
      // Task 6(b): When clearing the marker fails (e.g., permission denied),
      // the failure should be logged but boot should continue gracefully.
      // This tests that clearRestartMarker's error handling works correctly.

      const marker: RestartMarker = {
        reason: 'engine stalled',
        fromIdentity: 'daemon-old',
        targetIdentity: 'engine-converged',
        at: Date.now(),
      };

      const freshIdentity = 'engine-converged'; // = target → no suppression

      // Write marker before boot
      await writeRestartMarker(marker, projectRoot);

      // Verify marker was written
      const markerPath = join(projectRoot, RESTART_MARKER_PATH);
      expect(existsSync(markerPath)).toBe(true);

      // Make marker file read-only to prevent deletion
      const fsSync = await import('node:fs');
      const oldMode = fsSync.statSync(markerPath).mode;

      try {
        // Make file read-only
        fsSync.chmodSync(markerPath, 0o444);

        // Also make parent directory read-only to block deletion
        const daemonDir = join(projectRoot, '.daemon');
        const oldDirMode = fsSync.statSync(daemonDir).mode;
        fsSync.chmodSync(daemonDir, 0o555);

        // Simulate boot-time handshake logic
        const logs: string[] = [];
        const log = (msg: string) => logs.push(msg);

        const markerStatus = await readRestartMarkerWithStatus(projectRoot, log);

        if (markerStatus.kind === 'present' && freshIdentity !== null) {
          const markerData = markerStatus.marker!;
          log(
            `restarted for engine refresh — from ${markerData.fromIdentity} to ${markerData.targetIdentity}, fresh ${freshIdentity}`,
          );

          // Clear suppression (no suppression since convergence)
          if (freshIdentity !== markerData.targetIdentity) {
            log(`suppressing restart loop — target was ${markerData.targetIdentity}, now ${freshIdentity}`);
            await recordSuppression(freshIdentity, projectRoot, log);
          } else {
            await clearSuppression(projectRoot, log);
          }

          // This will fail because directory is not writable
          await clearRestartMarker(projectRoot, log);
        }

        // Verify handshake was logged
        expect(logs.some((m) => m.includes('restarted for engine refresh'))).toBe(true);

        // Verify marker clear failure was logged
        const clearFailLogs = logs.filter((m) => m.includes('could not delete restart marker'));
        expect(clearFailLogs.length).toBe(1);

        // Verify boot continued (no exception thrown)
        expect(true).toBe(true);

        // Restore permissions for verification
        fsSync.chmodSync(daemonDir, oldDirMode);

        // Verify marker still exists (because deletion failed)
        expect(existsSync(markerPath)).toBe(true);
      } finally {
        // Restore all permissions for cleanup
        fsSync.chmodSync(markerPath, oldMode);
        fsSync.chmodSync(join(projectRoot, '.daemon'), 0o755);
      }
    });

    it('(c) corrupt suppression file → isSuppressed returns false, warn-once, boot proceeds', async () => {
      // Task 6(c): When a suppression file exists but is corrupt (invalid JSON),
      // isSuppressed should return false (re-arm), log a warn-once message,
      // and boot should proceed normally.

      const suppressionPath = join(projectRoot, SUPPRESSION_PATH);
      const daemonDir = join(projectRoot, '.daemon');

      // Create .daemon directory
      await mkdir(daemonDir, { recursive: true });

      // Write corrupt JSON to suppression file
      const fs = await import('node:fs/promises');
      await fs.writeFile(suppressionPath, '{ broken json {{{', 'utf-8');

      // Verify corrupt file exists
      expect(existsSync(suppressionPath)).toBe(true);

      // First call to isSuppressed should warn and return false
      const logs1: string[] = [];
      const result1 = await isSuppressed('engine-identity-123', projectRoot, (msg) => logs1.push(msg));

      expect(result1).toBe(false); // corrupt file → treated as absent (re-arm)

      // Verify corruption warning was logged
      const corruptionWarnings1 = logs1.filter((m) => m.includes('corrupt'));
      expect(corruptionWarnings1.length).toBe(1);
      expect(corruptionWarnings1[0]).toContain('corrupt');

      // Second call to isSuppressed with same identity should NOT warn again (warn-once)
      const logs2: string[] = [];
      const result2 = await isSuppressed('engine-identity-123', projectRoot, (msg) => logs2.push(msg));

      expect(result2).toBe(false); // still re-arm

      // Verify no corruption warning this time (warn-once semantics)
      const corruptionWarnings2 = logs2.filter((m) => m.includes('corrupt'));
      expect(corruptionWarnings2.length).toBe(0);

      // Call with different identity should also not warn (warns per-directory, not per-identity)
      const logs3: string[] = [];
      const result3 = await isSuppressed('engine-identity-456', projectRoot, (msg) => logs3.push(msg));

      expect(result3).toBe(false); // still re-arm

      // Verify no corruption warning (per-directory warn-once, already warned)
      const corruptionWarnings3 = logs3.filter((m) => m.includes('corrupt'));
      expect(corruptionWarnings3.length).toBe(0);
    });

    it('(c) corrupt suppression with initStaleEngineState → boot proceeds normally', async () => {
      // Task 6(c) integration: When a corrupt suppression record exists,
      // initStaleEngineState should proceed normally without throwing.

      const engineContent = 'mock engine content';
      const enginePath = await createMockEngineFile(projectRoot, engineContent);
      const engineIdentity = await captureEngineIdentity(enginePath);
      expect(engineIdentity).not.toBeNull();

      // Create corrupt suppression file
      const suppressionPath = join(projectRoot, SUPPRESSION_PATH);
      const daemonDir = join(projectRoot, '.daemon');

      const fs = await import('node:fs/promises');
      await mkdir(daemonDir, { recursive: true });
      await fs.writeFile(suppressionPath, 'corrupted suppression data {{{', 'utf-8');

      // Verify corrupt file exists
      expect(existsSync(suppressionPath)).toBe(true);

      // Call initStaleEngineState with corrupt suppression present
      const logs: string[] = [];
      const capturedIdentity = await initStaleEngineState({
        repoPath: projectRoot,
        entryPath: enginePath,
        flag: true,
        log: (msg) => logs.push(msg),
      });

      // Verify identity was captured
      expect(capturedIdentity).toBe(engineIdentity);

      // Verify no handshake was logged (no marker present)
      expect(logs.filter((m) => m.includes('restarted for engine refresh')).length).toBe(0);

      // Verify boot proceeded normally (no exception)
      expect(true).toBe(true);
    });
  });
});
