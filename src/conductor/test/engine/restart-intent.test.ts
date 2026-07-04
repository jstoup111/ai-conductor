import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeRestartMarker,
  readRestartMarker,
  clearRestartMarker,
  readRestartMarkerWithStatus,
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
});
