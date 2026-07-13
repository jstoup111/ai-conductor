/**
 * Unit tests for the tolerant completion-signal reader used by the
 * auto-park contradiction guard (Task 1, #612).
 *
 * `readCompletionSignals(projectRoot)` parses `.pipeline/summary.json` and
 * returns `{ summaryTasksCompleted }`. It must never throw — missing files,
 * corrupt JSON, and absent/non-numeric `tasks_completed` all fail closed to
 * `0`, mirroring the tolerant-read pattern in `task-evidence.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readCompletionSignals,
  detectParkContradiction,
} from '../../src/engine/daemon-auto-park.js';

describe('readCompletionSignals', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-auto-park-unit-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('parses tasks_completed from a valid summary.json', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ tasks_completed: 5 }),
      'utf-8',
    );

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 5 });
  });

  it('returns 0 when summary.json is missing', async () => {
    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });

  it('returns 0 without throwing when summary.json is corrupt JSON', async () => {
    await writeFile(join(dir, '.pipeline', 'summary.json'), '{ not valid json', 'utf-8');

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });

  it('returns 0 when tasks_completed is absent', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ some_other_field: 1 }),
      'utf-8',
    );

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });

  it('returns 0 when tasks_completed is non-numeric', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ tasks_completed: 'five' }),
      'utf-8',
    );

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });
});

describe('detectParkContradiction', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-auto-park-contradiction-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns null when summary, evidence stamps, and resolved tasks are all zero', async () => {
    const result = await detectParkContradiction(dir, {
      resolvedTasks: 0,
      evidenceStampCount: 0,
    });

    expect(result).toBeNull();
  });

  it('returns a contradiction descriptor when only summaryTasksCompleted > 0', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ tasks_completed: 3 }),
      'utf-8',
    );

    const result = await detectParkContradiction(dir, {
      resolvedTasks: 0,
      evidenceStampCount: 0,
    });

    expect(result).toEqual({
      summaryTasksCompleted: 3,
      evidenceStamps: 0,
      resolvedTasks: 0,
    });
  });

  it('returns a contradiction descriptor when only evidenceStampCount > 0', async () => {
    const result = await detectParkContradiction(dir, {
      resolvedTasks: 0,
      evidenceStampCount: 2,
    });

    expect(result).toEqual({
      summaryTasksCompleted: 0,
      evidenceStamps: 2,
      resolvedTasks: 0,
    });
  });

  it('returns a contradiction descriptor when only resolvedTasks > 0', async () => {
    const result = await detectParkContradiction(dir, {
      resolvedTasks: 4,
      evidenceStampCount: 0,
    });

    expect(result).toEqual({
      summaryTasksCompleted: 0,
      evidenceStamps: 0,
      resolvedTasks: 4,
    });
  });
});
