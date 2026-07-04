import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import {
  writeRestartMarker,
  readRestartMarker,
  clearRestartMarker,
  readRestartMarkerWithStatus,
  recordSuppression,
  getSuppression,
  isSuppressed,
  clearSuppression,
  RESTART_MARKER_PATH,
  type RestartMarker,
  type RestartMarkerStatus,
} from '../../src/engine/restart-intent.js';

describe('engine/restart-intent — marker schema round-trip', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'restart-intent-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('writeRestartMarker + readRestartMarker', () => {
    it('writes and reads back a marker losslessly', async () => {
      const marker: RestartMarker = {
        reason: 'engine stalled for 30s',
        fromIdentity: 'daemon-12345',
        targetIdentity: 'engine-67890',
        at: Date.now(),
      };

      await writeRestartMarker(marker, dir);
      const read = await readRestartMarker(dir);

      expect(read).not.toBeNull();
      expect(read?.reason).toBe(marker.reason);
      expect(read?.fromIdentity).toBe(marker.fromIdentity);
      expect(read?.targetIdentity).toBe(marker.targetIdentity);
      expect(read?.at).toBe(marker.at);
    });

    it('handles null identities in round-trip', async () => {
      const marker: RestartMarker = {
        reason: 'manual restart',
        fromIdentity: null,
        targetIdentity: null,
        at: 1234567890,
      };

      await writeRestartMarker(marker, dir);
      const read = await readRestartMarker(dir);

      expect(read?.reason).toBe(marker.reason);
      expect(read?.fromIdentity).toBeNull();
      expect(read?.targetIdentity).toBeNull();
      expect(read?.at).toBe(marker.at);
    });

    it('creates .daemon/ directory if it does not exist', async () => {
      const marker: RestartMarker = {
        reason: 'test reason',
        fromIdentity: 'a',
        targetIdentity: 'b',
        at: Date.now(),
      };

      await writeRestartMarker(marker, dir);
      const markerFile = join(dir, RESTART_MARKER_PATH);
      const content = await readFile(markerFile, 'utf-8');
      expect(content).toBeTruthy();
    });

    it('overwrites a prior marker', async () => {
      const marker1: RestartMarker = {
        reason: 'first',
        fromIdentity: 'a',
        targetIdentity: 'b',
        at: 1000,
      };
      const marker2: RestartMarker = {
        reason: 'second',
        fromIdentity: 'c',
        targetIdentity: 'd',
        at: 2000,
      };

      await writeRestartMarker(marker1, dir);
      await writeRestartMarker(marker2, dir);
      const read = await readRestartMarker(dir);

      expect(read?.reason).toBe('second');
      expect(read?.at).toBe(2000);
    });

    it('returns null when marker file does not exist', async () => {
      const read = await readRestartMarker(dir);
      expect(read).toBeNull();
    });

    it('stores marker as JSON and verifies all fields on round-trip', async () => {
      const marker: RestartMarker = {
        reason: 'engine timeout after 60s of inactivity',
        fromIdentity: 'conductor-abc',
        targetIdentity: 'engine-xyz',
        at: 1688256000000, // Example timestamp
      };

      await writeRestartMarker(marker, dir);

      // Verify the file exists and contains JSON
      const markerFile = join(dir, RESTART_MARKER_PATH);
      const rawContent = await readFile(markerFile, 'utf-8');
      const parsed = JSON.parse(rawContent);

      expect(parsed.reason).toBe(marker.reason);
      expect(parsed.fromIdentity).toBe(marker.fromIdentity);
      expect(parsed.targetIdentity).toBe(marker.targetIdentity);
      expect(parsed.at).toBe(marker.at);

      // Verify reading through the API returns same values
      const read = await readRestartMarker(dir);
      expect(read).toEqual(marker);
    });
  });

  describe('clearRestartMarker', () => {
    it('deletes an existing marker file', async () => {
      const marker: RestartMarker = {
        reason: 'test',
        fromIdentity: 'a',
        targetIdentity: 'b',
        at: Date.now(),
      };

      await writeRestartMarker(marker, dir);
      expect(await readRestartMarker(dir)).not.toBeNull();

      await clearRestartMarker(dir);
      expect(await readRestartMarker(dir)).toBeNull();
    });

    it('does not throw when marker file does not exist', async () => {
      await expect(clearRestartMarker(dir)).resolves.toBeUndefined();
    });

    it('handles errors gracefully', async () => {
      // Call on an already-empty directory; should not throw
      await expect(clearRestartMarker(dir)).resolves.toBeUndefined();
    });
  });

  describe('readRestartMarkerWithStatus — corrupt marker handling', () => {
    it('detects corrupt marker and returns absent-corrupt', async () => {
      const markerPath = join(dir, '.daemon', 'RESTART_PENDING');
      await mkdir(dirname(markerPath), { recursive: true });
      // Write garbage bytes that are not valid JSON
      await writeFile(markerPath, 'garbage bytes not json {{{', 'utf-8');

      const status = await readRestartMarkerWithStatus(dir);

      expect(status.kind).toBe('absent-corrupt');
      expect(status.marker).toBeNull();
    });

    it('removes the corrupt marker file after detection', async () => {
      const markerPath = join(dir, '.daemon', 'RESTART_PENDING');
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(markerPath, '{invalid json}', 'utf-8');

      await readRestartMarkerWithStatus(dir);

      // File should be deleted
      const exists = await readFile(markerPath, 'utf-8')
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('logs one warning when corrupt marker is detected', async () => {
      const markerPath = join(dir, '.daemon', 'RESTART_PENDING');
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(markerPath, 'corrupt {data', 'utf-8');

      const warnings: string[] = [];
      const log = (msg: string) => warnings.push(msg);

      await readRestartMarkerWithStatus(dir, log);

      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('corrupt');
    });

    it('returns absent silently for missing marker in boot-style read', async () => {
      const warnings: string[] = [];
      const log = (msg: string) => warnings.push(msg);

      const status = await readRestartMarkerWithStatus(dir, log);

      expect(status.kind).toBe('absent');
      expect(status.marker).toBeNull();
      expect(warnings.length).toBe(0);
    });

    it('returns present with marker data for valid marker', async () => {
      const marker: RestartMarker = {
        reason: 'engine stalled',
        fromIdentity: 'daemon-1',
        targetIdentity: 'engine-1',
        at: Date.now(),
      };

      await writeRestartMarker(marker, dir);

      const status = await readRestartMarkerWithStatus(dir);

      expect(status.kind).toBe('present');
      expect(status.marker).not.toBeNull();
      expect(status.marker?.reason).toBe(marker.reason);
    });
  });

  describe('recordSuppression + getSuppression — non-convergence at boot', () => {
    it('records suppression for a fresh identity when marker target differs', async () => {
      // Marker was written with old target
      const marker: RestartMarker = {
        reason: 'engine stalled',
        fromIdentity: 'daemon-old',
        targetIdentity: 'engine-old-123',
        at: Date.now(),
      };
      await writeRestartMarker(marker, dir);

      // Fresh identity differs from target
      const freshIdentity = 'engine-fresh-456';

      // Record suppression for the fresh identity
      await recordSuppression(freshIdentity, dir);

      // Verify suppression was recorded
      const suppression = await getSuppression(dir);
      expect(suppression).not.toBeNull();
      expect(suppression?.suppressedTarget).toBe(freshIdentity);
      expect(typeof suppression?.at).toBe('number');
    });

    it('suppression record persists alongside marker', async () => {
      const marker: RestartMarker = {
        reason: 'engine stalled',
        fromIdentity: 'daemon-1',
        targetIdentity: 'engine-old',
        at: Date.now(),
      };
      await writeRestartMarker(marker, dir);

      const freshIdentity = 'engine-fresh';
      await recordSuppression(freshIdentity, dir);

      // Both files should exist
      const markerPath = join(dir, RESTART_MARKER_PATH);
      const suppressionPath = join(dir, '.daemon', 'RESTART_PENDING.suppression');

      expect(existsSync(markerPath)).toBe(true);
      expect(existsSync(suppressionPath)).toBe(true);

      // Both should be readable
      const markerData = await readRestartMarker(dir);
      const suppressionData = await getSuppression(dir);

      expect(markerData).not.toBeNull();
      expect(suppressionData).not.toBeNull();
      expect(suppressionData?.suppressedTarget).toBe(freshIdentity);
    });

    it('getSuppression returns null when suppression file does not exist', async () => {
      const suppression = await getSuppression(dir);
      expect(suppression).toBeNull();
    });

    it('getSuppression returns null for corrupt suppression file', async () => {
      const suppressionPath = join(dir, '.daemon', 'RESTART_PENDING.suppression');
      await mkdir(dirname(suppressionPath), { recursive: true });
      // Write corrupt JSON
      await writeFile(suppressionPath, 'garbage {{{', 'utf-8');

      const suppression = await getSuppression(dir);
      expect(suppression).toBeNull();
    });

    it('recordSuppression handles null suppressedTarget', async () => {
      await recordSuppression(null, dir);

      const suppression = await getSuppression(dir);
      expect(suppression).not.toBeNull();
      expect(suppression?.suppressedTarget).toBeNull();
    });

    it('suppression file contains suppressedTarget and timestamp', async () => {
      const freshIdentity = 'engine-abc-123';
      const before = Date.now();
      await recordSuppression(freshIdentity, dir);
      const after = Date.now();

      const suppressionPath = join(dir, '.daemon', 'RESTART_PENDING.suppression');
      const rawContent = await readFile(suppressionPath, 'utf-8');
      const parsed = JSON.parse(rawContent);

      expect(parsed.suppressedTarget).toBe(freshIdentity);
      expect(typeof parsed.at).toBe('number');
      expect(parsed.at).toBeGreaterThanOrEqual(before);
      expect(parsed.at).toBeLessThanOrEqual(after);
    });

    it('recordSuppression overwrites prior suppression record', async () => {
      await recordSuppression('identity-1', dir);
      const suppression1 = await getSuppression(dir);

      await recordSuppression('identity-2', dir);
      const suppression2 = await getSuppression(dir);

      expect(suppression1?.suppressedTarget).toBe('identity-1');
      expect(suppression2?.suppressedTarget).toBe('identity-2');
    });
  });

  describe('isSuppressed + clearSuppression — hold, re-arm, log-once', () => {
    it('returns true when currentIdentity matches suppressedTarget', async () => {
      const suppressedIdentity = 'engine-suppressed-123';
      await recordSuppression(suppressedIdentity, dir);

      const result = await isSuppressed(suppressedIdentity, dir);

      expect(result).toBe(true);
    });

    it('returns false when currentIdentity differs from suppressedTarget', async () => {
      const suppressedIdentity = 'engine-suppressed-123';
      await recordSuppression(suppressedIdentity, dir);

      const result = await isSuppressed('engine-different-456', dir);

      expect(result).toBe(false);
    });

    it('returns false when suppression record does not exist (re-arm)', async () => {
      const result = await isSuppressed('engine-any-identity', dir);

      expect(result).toBe(false);
    });

    it('returns false when suppression record is corrupt (treat as absent, re-arm)', async () => {
      const suppressionPath = join(dir, '.daemon', 'RESTART_PENDING.suppression');
      await mkdir(dirname(suppressionPath), { recursive: true });
      await writeFile(suppressionPath, 'garbage {{{', 'utf-8');

      const result = await isSuppressed('engine-any-identity', dir);

      expect(result).toBe(false);
    });

    it('logs once per session when identity is suppressed', async () => {
      const suppressedIdentity = 'engine-suppressed-123';
      await recordSuppression(suppressedIdentity, dir);

      const warnings: string[] = [];
      const log = (msg: string) => warnings.push(msg);

      // First call should log
      await isSuppressed(suppressedIdentity, dir, log);
      expect(warnings.length).toBe(1);

      // Subsequent calls with same identity should not log again
      await isSuppressed(suppressedIdentity, dir, log);
      await isSuppressed(suppressedIdentity, dir, log);
      expect(warnings.length).toBe(1);
    });

    it('logs once when suppression record is corrupt', async () => {
      const suppressionPath = join(dir, '.daemon', 'RESTART_PENDING.suppression');
      await mkdir(dirname(suppressionPath), { recursive: true });
      await writeFile(suppressionPath, 'corrupt data', 'utf-8');

      const warnings: string[] = [];
      const log = (msg: string) => warnings.push(msg);

      // First call should log
      await isSuppressed('engine-any', dir, log);
      expect(warnings.length).toBe(1);

      // Subsequent calls should not log again (same corruption state)
      await isSuppressed('engine-any', dir, log);
      expect(warnings.length).toBe(1);
    });

    it('does not log when suppression record is absent', async () => {
      const warnings: string[] = [];
      const log = (msg: string) => warnings.push(msg);

      await isSuppressed('engine-any', dir, log);

      expect(warnings.length).toBe(0);
    });

    it('clears suppression when identity moves to new value', async () => {
      const suppressedIdentity = 'engine-old-123';
      await recordSuppression(suppressedIdentity, dir);

      // Old identity is suppressed
      expect(await isSuppressed(suppressedIdentity, dir)).toBe(true);

      // New identity is not suppressed (identity moved)
      expect(await isSuppressed('engine-new-456', dir)).toBe(false);

      // Suppression record should still exist (only cleared when we call clearSuppression)
      const suppression = await getSuppression(dir);
      expect(suppression?.suppressedTarget).toBe(suppressedIdentity);
    });

    it('clearSuppression deletes the suppression record', async () => {
      const suppressedIdentity = 'engine-to-clear-123';
      await recordSuppression(suppressedIdentity, dir);

      // Verify suppression exists
      expect(await getSuppression(dir)).not.toBeNull();

      // Clear suppression
      await clearSuppression(dir);

      // Verify suppression is gone
      expect(await getSuppression(dir)).toBeNull();
    });

    it('clearSuppression does not throw when suppression does not exist', async () => {
      await expect(clearSuppression(dir)).resolves.toBeUndefined();
    });

    it('isSuppressed returns true for null currentIdentity matching null suppressedTarget', async () => {
      await recordSuppression(null, dir);

      const result = await isSuppressed(null, dir);

      expect(result).toBe(true);
    });

    it('isSuppressed returns false when currentIdentity is null but suppressedTarget is not', async () => {
      await recordSuppression('engine-123', dir);

      const result = await isSuppressed(null, dir);

      expect(result).toBe(false);
    });

    it('isSuppressed returns false when currentIdentity is not null but suppressedTarget is', async () => {
      await recordSuppression(null, dir);

      const result = await isSuppressed('engine-123', dir);

      expect(result).toBe(false);
    });
  });
});
