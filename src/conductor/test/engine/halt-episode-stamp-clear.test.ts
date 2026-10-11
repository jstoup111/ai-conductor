// Covers: task:7
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearHaltForResume,
  clearMarker,
  HALT_CLEARED_MARKER,
  HALT_MARKER,
  REKICK_SENTINEL,
  recoverEpisodeHalts,
  rekickSweep,
} from '../../src/engine/daemon-rekick.js';
import { HALT_CLASS_MARKER, HALT_EPISODE_MARKER } from '../../src/engine/halt-marker.js';

const SHA = 'a'.repeat(40);

describe('Task 7 — clearing a HALT removes its durable episode stamp', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function worktree(name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'halt-episode-stamp-clear-'));
    roots.push(root);
    const path = join(root, name);
    await mkdir(join(path, '.pipeline'), { recursive: true });
    return path;
  }

  async function seedHalt(path: string, stamped = true): Promise<void> {
    await writeFile(join(path, HALT_MARKER), 'temporary daemon halt\n', 'utf8');
    await writeFile(join(path, HALT_CLASS_MARKER), 'mechanical\n', 'utf8');
    if (stamped) await writeFile(join(path, HALT_EPISODE_MARKER), '{"deadlineMs":1}\n', 'utf8');
  }

  async function exists(path: string): Promise<boolean> {
    return access(path).then(() => true, () => false);
  }

  it('clears a stamped HALT and preserves the normal clear artifacts', async () => {
    const path = await worktree('stamped');
    await seedHalt(path);

    await clearMarker(path);

    await expect(access(join(path, HALT_CLEARED_MARKER))).resolves.toBeUndefined();
    await expect(access(join(path, REKICK_SENTINEL))).resolves.toBeUndefined();
    await expect(exists(join(path, HALT_MARKER))).resolves.toBe(false);
    await expect(exists(join(path, HALT_CLASS_MARKER))).resolves.toBe(false);
    await expect(exists(join(path, HALT_EPISODE_MARKER))).resolves.toBe(false);
  });

  it('clears an unstamped HALT exactly as before without throwing', async () => {
    const path = await worktree('unstamped');
    await seedHalt(path, false);

    await expect(clearMarker(path)).resolves.toBeUndefined();

    await expect(access(join(path, HALT_CLEARED_MARKER))).resolves.toBeUndefined();
    await expect(access(join(path, REKICK_SENTINEL))).resolves.toBeUndefined();
    await expect(exists(join(path, HALT_MARKER))).resolves.toBe(false);
    await expect(exists(join(path, HALT_CLASS_MARKER))).resolves.toBe(false);
    await expect(exists(join(path, HALT_EPISODE_MARKER))).resolves.toBe(false);
  });

  it('episode recovery clears its stamped real worktree through clearMarker', async () => {
    const path = await worktree('episode-recovery');
    await seedHalt(path);

    await expect(recoverEpisodeHalts({
      stampedHalts: async () => ['episode-recovery'],
      readHaltClass: async () => 'mechanical',
      clearMarker: async () => clearMarker(path),
    })).resolves.toEqual(['episode-recovery']);

    await expect(exists(join(path, HALT_EPISODE_MARKER))).resolves.toBe(false);
  });

  it('the base-advance rekick sweep clears its stamped real worktree through clearMarker', async () => {
    const path = await worktree('base-advance');
    await seedHalt(path);

    await expect(rekickSweep({
      listHaltedWorktrees: async () => ['base-advance'],
      readHaltReason: async () => 'temporary daemon halt',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {},
      clearMarker: async () => clearMarker(path),
      lastRekickSha: new Map(),
    }, SHA)).resolves.toEqual({ cleared: ['base-advance'], skipped: [] });

    await expect(exists(join(path, HALT_EPISODE_MARKER))).resolves.toBe(false);
  });

  it('the operator authorized-resume clear path clears its stamped real worktree', async () => {
    const path = await worktree('operator-rekick');
    await seedHalt(path);

    await expect(clearHaltForResume({
      worktreePath: path,
      slug: 'operator-rekick',
      clearMarker,
    })).resolves.toBe('confirmed');

    await expect(exists(join(path, HALT_EPISODE_MARKER))).resolves.toBe(false);
  });
});
