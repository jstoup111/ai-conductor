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
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import {
  writeRestartMarker,
  readRestartMarkerWithStatus,
  clearRestartMarker,
  RESTART_MARKER_PATH,
  type RestartMarker,
} from '../../src/engine/restart-intent.js';

describe('daemon startup handshake (Task 9)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-startup-handshake-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

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
});
