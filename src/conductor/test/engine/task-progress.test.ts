import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countResolvedTasks,
  haltMarkerExists,
  clearHaltMarker,
  haltMarkerPath,
  HALT_MARKER_RELATIVE,
} from '../../src/engine/task-progress.js';

describe('task-progress', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-progress-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('countResolvedTasks', () => {
    it('returns 0 when .pipeline/task-status.json is absent', async () => {
      const count = await countResolvedTasks(dir);
      expect(count).toBe(0);
    });

    it('returns 0 when the file is not valid JSON', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/task-status.json'), 'not json');
      expect(await countResolvedTasks(dir)).toBe(0);
    });

    it('counts completed + skipped tasks in the array shape', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 1, status: 'completed' },
            { id: 2, status: 'completed' },
            { id: 3, status: 'skipped' },
            { id: 4, status: 'pending' },
            { id: 5, status: 'in_progress' },
          ],
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('counts completed + skipped tasks in the id-keyed map shape', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: {
            '1': { status: 'completed' },
            '2': { status: 'pending' },
            '3': { status: 'skipped' },
            '4': { status: 'completed' },
          },
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('returns 0 when the tasks field is missing or empty', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ plan_ref: 'foo' }),
      );
      expect(await countResolvedTasks(dir)).toBe(0);
    });
  });

  describe('halt marker', () => {
    it('haltMarkerPath returns the project-relative location', () => {
      expect(haltMarkerPath(dir)).toBe(join(dir, HALT_MARKER_RELATIVE));
    });

    it('haltMarkerExists returns false when missing', async () => {
      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('haltMarkerExists returns true when present', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'blocker');
      expect(await haltMarkerExists(dir)).toBe(true);
    });

    it('clearHaltMarker removes an existing marker', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'x');

      await clearHaltMarker(dir);

      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('clearHaltMarker is safe to call when the marker is absent', async () => {
      await clearHaltMarker(dir);
      expect(await haltMarkerExists(dir)).toBe(false);
    });
  });
});
