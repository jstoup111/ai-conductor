// Covers: task:10
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearMarker,
  HALT_CLEARED_MARKER,
  HALT_MARKER,
  readRawHaltClass,
  recoverEpisodeHalts,
  REKICK_SENTINEL,
} from '../../src/engine/daemon-rekick.js';
import { createEpisodeHaltTracker } from '../../src/engine/episode-halt-tracker.js';
import { HALT_CLASS_MARKER, HALT_EPISODE_MARKER } from '../../src/engine/halt-marker.js';

describe('Task 10 — episode HALT recovery', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function worktreeBase(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'episode-halt-recovery-'));
    roots.push(root);
    return root;
  }

  async function seed(base: string, slug: string, haltClass?: string): Promise<string> {
    const path = join(base, slug);
    await mkdir(join(path, '.pipeline'), { recursive: true });
    await writeFile(join(path, HALT_MARKER), `${slug} halt\n`);
    if (haltClass !== undefined) await writeFile(join(path, HALT_CLASS_MARKER), `${haltClass}\n`);
    return path;
  }

  it('clears mechanical HALTs and retains operator, human, and unclassified dispositions', async () => {
    const base = await worktreeBase();
    const mechanical = await seed(base, 'mechanical', 'mechanical');
    const parked = await seed(base, 'parked', 'mechanical');
    const human = await seed(base, 'human', 'needs-human');
    const absent = await seed(base, 'absent');
    const unreadable = await seed(base, 'unreadable', 'mechanical');
    await rm(join(unreadable, HALT_CLASS_MARKER));
    await mkdir(join(unreadable, HALT_CLASS_MARKER));
    const lines: string[] = [];

    await expect(recoverEpisodeHalts({
      stampedHalts: async () => ['mechanical', 'parked', 'human', 'absent', 'unreadable'],
      isOperatorParked: async (slug) => slug === 'parked',
      readHaltClass: (slug) => readRawHaltClass(join(base, slug)),
      clearMarker: (slug) => clearMarker(join(base, slug)),
      log: (line) => lines.push(line),
    })).resolves.toEqual(['mechanical']);

    await expect(access(join(mechanical, HALT_MARKER))).rejects.toThrow();
    await expect(access(join(parked, HALT_MARKER))).resolves.toBeUndefined();
    await expect(access(join(human, HALT_MARKER))).resolves.toBeUndefined();
    await expect(access(join(absent, HALT_MARKER))).resolves.toBeUndefined();
    await expect(access(join(unreadable, HALT_MARKER))).resolves.toBeUndefined();
    expect(lines).toEqual(expect.arrayContaining([
      'episode-end sweep: re-kicked mechanical (episode-caused HALT cleared)',
      'episode-end sweep: parked operator-parked — left for a human',
      'episode-end sweep: human retained — halt disposition needs-human',
      'episode-end sweep: absent retained — halt disposition unclassified',
      'episode-end sweep: unreadable retained — halt disposition unclassified',
    ]));
  });

  it('drops a stamp whose HALT disappeared without re-kicking it', async () => {
    const base = await worktreeBase();
    const path = await seed(base, 'missing-halt', 'mechanical');
    const tracker = createEpisodeHaltTracker({ worktreeBase: base, log: () => {} });
    await tracker.onHaltWritten('missing-halt', true, 0);
    await rm(join(path, HALT_MARKER));
    let clearCalls = 0;

    await expect(recoverEpisodeHalts({
      stampedHalts: () => tracker.listRecoverable(1),
      readHaltClass: (slug) => readRawHaltClass(join(base, slug)),
      clearMarker: async () => { clearCalls += 1; },
    })).resolves.toEqual([]);

    expect(clearCalls).toBe(0);
    await expect(access(join(path, REKICK_SENTINEL))).rejects.toThrow();
    await expect(access(join(path, HALT_CLEARED_MARKER))).rejects.toThrow();
    await expect(access(join(path, HALT_EPISODE_MARKER))).rejects.toThrow();
  });

  it('isolates a throwing slug and continues to evaluate the remaining stamped HALTs', async () => {
    const base = await worktreeBase();
    const broken = await seed(base, 'broken', 'mechanical');
    const mechanical = await seed(base, 'mechanical', 'mechanical');
    const human = await seed(base, 'human', 'needs-human');
    const lines: string[] = [];

    await expect(recoverEpisodeHalts({
      stampedHalts: async () => ['broken', 'mechanical', 'human'],
      readHaltClass: async (slug) => {
        if (slug === 'broken') throw new Error('read exploded');
        return readRawHaltClass(join(base, slug));
      },
      clearMarker: (slug) => clearMarker(join(base, slug)),
      log: (line) => lines.push(line),
    })).resolves.toEqual(['mechanical']);

    await expect(access(join(broken, HALT_MARKER))).resolves.toBeUndefined();
    await expect(access(join(mechanical, HALT_MARKER))).rejects.toThrow();
    await expect(access(join(human, HALT_MARKER))).resolves.toBeUndefined();
    expect(lines).toContain('episode-end sweep: failed to evaluate broken (read exploded)');
    expect(lines).toContain('episode-end sweep: human retained — halt disposition needs-human');
  });
});
