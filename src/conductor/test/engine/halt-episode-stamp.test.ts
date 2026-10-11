import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Covers: task:6
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

import { writeFile } from 'node:fs/promises';
import {
  HALT_EPISODE_MARKER,
  HALT_MARKER,
  readEpisodeStamp,
  writeEpisodeStamp,
  writeHaltMarker,
} from '../../src/engine/halt-marker.js';

describe('episode HALT stamps', () => {
  let root: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function makeRoot(haltBody = 'rate limited\n'): Promise<string> {
    root = await mkdtemp(join(tmpdir(), 'halt-episode-stamp-'));
    await mkdir(join(root, '.pipeline'));
    await writeFile(join(root, HALT_MARKER), haltBody, 'utf8');
    return root;
  }

  it('writes a deadline and digest for the current HALT body', async () => {
    const worktree = await makeRoot('rate limited\n');

    await expect(writeEpisodeStamp(worktree, 123_456)).resolves.toEqual({ status: 'written' });
    await expect(readFile(join(worktree, HALT_EPISODE_MARKER), 'utf8')).resolves.toBe(JSON.stringify({
      deadlineMs: 123_456,
      haltDigest: createHash('sha256').update('rate limited\n').digest('hex'),
    }));
  });

  it('returns failed rather than throwing when its stamp cannot be written', async () => {
    const worktree = await makeRoot();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(writeFile).mockImplementation(async (path: any, ...rest: any[]) => {
      if (path === `${join(worktree, HALT_EPISODE_MARKER)}.tmp`) throw new Error('disk full');
      return (actual.writeFile as any)(path, ...rest);
    });

    await expect(writeEpisodeStamp(worktree, 123_456)).resolves.toEqual({ status: 'failed', reason: 'disk full' });
  });

  it('validates only a stamp that still matches the current HALT body', async () => {
    const worktree = await makeRoot('original\n');
    await writeEpisodeStamp(worktree, 123_456);

    await expect(readEpisodeStamp(worktree)).resolves.toEqual({ kind: 'valid', deadlineMs: 123_456 });
    await writeFile(join(worktree, HALT_MARKER), 'replacement\n', 'utf8');
    await expect(readEpisodeStamp(worktree)).resolves.toEqual({ kind: 'invalid', reason: 'digest-mismatch' });
  });

  it.each([
    ['an absent stamp', undefined, { kind: 'invalid', reason: 'absent' }],
    ['empty stamp content', '', { kind: 'invalid', reason: 'malformed' }],
    ['non-JSON stamp content', 'not json', { kind: 'invalid', reason: 'malformed' }],
  ] as const)('returns $0 as invalid without throwing', async (_description, stamp, expected) => {
    const worktree = await makeRoot();
    if (stamp !== undefined) await writeFile(join(worktree, HALT_EPISODE_MARKER), stamp, 'utf8');

    await expect(readEpisodeStamp(worktree)).resolves.toEqual(expected);
  });

  it('returns halt-absent when the stamp remains after HALT is gone', async () => {
    const worktree = await makeRoot();
    await writeEpisodeStamp(worktree, 123_456);
    await rm(join(worktree, HALT_MARKER));

    await expect(readEpisodeStamp(worktree)).resolves.toEqual({ kind: 'invalid', reason: 'halt-absent' });
  });

  it('removes a stale episode stamp before it writes a replacement HALT body', async () => {
    const worktree = await makeRoot();
    await writeEpisodeStamp(worktree, 123_456);

    await expect(writeHaltMarker(worktree, 'replacement\n', 'mechanical')).resolves.toEqual({ status: 'written' });
    await expect(readFile(join(worktree, HALT_EPISODE_MARKER), 'utf8')).rejects.toThrow();
  });

  it('removes the stale episode stamp even if writing the new HALT body fails', async () => {
    const worktree = await makeRoot();
    await writeEpisodeStamp(worktree, 123_456);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(writeFile).mockImplementation(async (path: any, ...rest: any[]) => {
      if (path === join(worktree, HALT_MARKER) && rest[0] === 'replacement\n') throw new Error('disk full');
      return (actual.writeFile as any)(path, ...rest);
    });

    await expect(writeHaltMarker(worktree, 'replacement\n', 'mechanical')).resolves.toMatchObject({ status: 'failed' });
    await expect(readFile(join(worktree, HALT_EPISODE_MARKER), 'utf8')).rejects.toThrow();
  });
});
