// Covers: task:9
import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HALT_EPISODE_MARKER,
  HALT_MARKER,
  readEpisodeStamp,
} from '../../src/engine/halt-marker.js';
import { createEpisodeHaltTracker } from '../../src/engine/episode-halt-tracker.js';

describe('episode HALT tracker', () => {
  let worktreeBase: string | undefined;

  afterEach(async () => {
    if (worktreeBase) await rm(worktreeBase, { recursive: true, force: true });
    worktreeBase = undefined;
  });

  async function createWorktree(slug: string, haltBody = 'rate limited\n'): Promise<string> {
    const worktree = join(worktreeBase!, slug);
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, HALT_MARKER), haltBody, 'utf8');
    return worktree;
  }

  async function createTracker(log: (line: string) => void = () => {}) {
    worktreeBase = await mkdtemp(join(tmpdir(), 'episode-halt-tracker-'));
    return createEpisodeHaltTracker({ worktreeBase, log });
  }

  it('writes only episode-caused HALTs and logs a failed stamp without making it recoverable', async () => {
    const lines: string[] = [];
    const tracker = await createTracker((line) => lines.push(line));
    const stamped = await createWorktree('stamped');
    const ordinary = await createWorktree('ordinary');
    const failed = join(worktreeBase!, 'failed');
    await writeFile(failed, 'not a directory', 'utf8');

    await expect(tracker.onHaltWritten('stamped', true, 100)).resolves.toBeUndefined();
    await expect(tracker.onHaltWritten('ordinary', false, 100)).resolves.toBeUndefined();
    await expect(tracker.onHaltWritten('failed', true, 100)).resolves.toBeUndefined();

    await expect(readEpisodeStamp(stamped)).resolves.toEqual({ kind: 'valid', deadlineMs: 100 });
    await expect(access(join(ordinary, HALT_EPISODE_MARKER))).rejects.toThrow();
    await expect(tracker.listRecoverable(100)).resolves.toEqual(['stamped']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('failed');
  });

  it('returns expired valid stamps, retains future stamps, and survives a new tracker instance', async () => {
    const tracker = await createTracker();
    const expired = await createWorktree('expired');
    const future = await createWorktree('future');

    await tracker.onHaltWritten('expired', true, 100);
    await tracker.onHaltWritten('future', true, 101);

    await expect(tracker.listRecoverable(100)).resolves.toEqual(['expired']);
    await expect(readEpisodeStamp(future)).resolves.toEqual({ kind: 'valid', deadlineMs: 101 });

    const afterRestart = createEpisodeHaltTracker({ worktreeBase: worktreeBase!, log: () => {} });
    await expect(afterRestart.listRecoverable(100)).resolves.toEqual(['expired']);
    await expect(readFile(join(expired, HALT_MARKER), 'utf8')).resolves.toBe('rate limited\n');
  });

  it.each([
    ['a replaced HALT', async (worktree: string) => writeFile(join(worktree, HALT_MARKER), 'replacement\n', 'utf8')],
    ['a missing HALT', async (worktree: string) => rm(join(worktree, HALT_MARKER))],
    ['a malformed stamp', async (worktree: string) => writeFile(join(worktree, HALT_EPISODE_MARKER), '{broken', 'utf8')],
  ])('discards the stamp for %s without changing its HALT', async (_description, invalidate) => {
    const tracker = await createTracker();
    const worktree = await createWorktree('stale');
    await tracker.onHaltWritten('stale', true, 100);
    await invalidate(worktree);
    const haltBefore = await readFile(join(worktree, HALT_MARKER), 'utf8').catch(() => undefined);

    await expect(tracker.listRecoverable(100)).resolves.toEqual([]);
    await expect(access(join(worktree, HALT_EPISODE_MARKER))).rejects.toThrow();
    await expect(readFile(join(worktree, HALT_MARKER), 'utf8').catch(() => undefined)).resolves.toBe(haltBefore);
  });

  it('does not attach an orphaned stamp to a later hand-written HALT', async () => {
    const tracker = await createTracker();
    const worktree = await createWorktree('hand-cleared', 'episode halt\n');
    await tracker.onHaltWritten('hand-cleared', true, 100);

    await rm(join(worktree, HALT_MARKER));
    await rm(join(worktree, '.pipeline', 'HALT.class'), { force: true });
    await writeFile(join(worktree, HALT_MARKER), 'operator halt\n', 'utf8');

    await expect(tracker.listRecoverable(100)).resolves.toEqual([]);
    await expect(access(join(worktree, HALT_EPISODE_MARKER))).rejects.toThrow();
    await expect(readFile(join(worktree, HALT_MARKER), 'utf8')).resolves.toBe('operator halt\n');
  });
});
