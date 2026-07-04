import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeRestartMarker,
  readRestartMarker,
  clearRestartMarker,
  RESTART_MARKER_PATH,
  type RestartMarker,
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
});
