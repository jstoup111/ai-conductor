import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { markRekicked, readRekicked } from '../../src/engine/daemon-deps.js';
import { clearMarker, rekickSweep, REKICK_SENTINEL, type RekickSweepDeps } from '../../src/engine/daemon-rekick.js';

const SHA_X = 'a'.repeat(40);
const SHA_Y = 'b'.repeat(40);
let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('durable once-per-SHA re-kick guard', () => {
  it('survives a restarted guard at the same SHA and permits a later SHA', async () => {
    root = await mkdtemp(join(tmpdir(), 'rekick-sha-durable-'));
    const slug = 'halted-feature';
    const worktree = join(root, '.worktrees', slug);
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'HALT'), 'halted\n');

    const makeDeps = (lastRekickSha: Map<string, string>): RekickSweepDeps => ({
      listHaltedWorktrees: async () => ['halted-feature'],
      readHaltReason: async () => 'fixture halt',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {},
      clearMarker: async () => clearMarker(worktree),
      lastRekickSha,
      markRekicked: (feature, sha) => markRekicked(root, feature, sha),
    });

    const first = await rekickSweep(makeDeps(new Map()), SHA_X);
    expect(first).toEqual({ cleared: [slug], skipped: [] });
    expect(await readRekicked(root)).toEqual(new Map([[slug, SHA_X]]));

    // Recreate the live halt as though a subsequent dispatch halted again,
    // then discard the in-memory guard to model a daemon restart.
    await writeFile(join(worktree, '.pipeline', 'HALT'), 'halted again\n');
    const second = await rekickSweep(makeDeps(await readRekicked(root)), SHA_X);
    expect(second).toEqual({ cleared: [], skipped: [slug] });
    await expect(access(join(worktree, '.pipeline', 'HALT'))).resolves.toBeUndefined();
    await expect(access(join(worktree, REKICK_SENTINEL))).resolves.toBeUndefined();

    const third = await rekickSweep(makeDeps(await readRekicked(root)), SHA_Y);
    expect(third).toEqual({ cleared: [slug], skipped: [] });
    expect(await readRekicked(root)).toEqual(new Map([[slug, SHA_Y]]));
  });
});
