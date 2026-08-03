import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diffParkedMarkers,
  snapshotParkedMarkers,
} from './park-leak-guard.js';

describe('park-leak-guard: snapshotParkedMarkers & diffParkedMarkers', () => {
  const temporaryDirectories: string[] = [];

  async function createMarkerDirectory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);
    const markers = join(root, '.daemon', 'parked');
    await mkdir(markers, { recursive: true });
    return markers;
  }

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('snapshots top-level regular marker files by slug and content', async () => {
    const markers = await createMarkerDirectory();
    await writeFile(join(markers, 'feature-a'), 'parked by operator\n');
    await mkdir(join(markers, 'nested'));

    await expect(snapshotParkedMarkers(markers)).resolves.toEqual({
      exists: true,
      markers: { 'feature-a': 'parked by operator\n' },
    });
  });

  it('returns an empty snapshot when the parked marker directory is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);

    await expect(snapshotParkedMarkers(join(root, '.daemon', 'parked'))).resolves.toEqual({
      exists: false,
      markers: {},
    });
  });

  it('returns an absent snapshot when the parked marker baseline cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'park-leak-guard-test-'));
    temporaryDirectories.push(root);
    const markers = join(root, '.daemon', 'parked');
    await mkdir(join(root, '.daemon'));
    await writeFile(markers, 'not a directory');

    await expect(snapshotParkedMarkers(markers)).resolves.toEqual({
      exists: false,
      markers: {},
    });
  });

  it('classifies added, removed, and changed marker content without false positives', () => {
    expect(diffParkedMarkers(
      { exists: true, markers: { unchanged: 'same', removed: 'before', modified: 'old' } },
      { exists: true, markers: { unchanged: 'same', added: 'after', modified: 'new' } },
    )).toEqual({
      added: ['added'],
      removed: ['removed'],
      modified: ['modified'],
    });
  });

  it('returns empty diff arrays for identical snapshots', () => {
    expect(diffParkedMarkers(
      { exists: true, markers: { feature: 'parked by operator\n' } },
      { exists: true, markers: { feature: 'parked by operator\n' } },
    )).toEqual({ added: [], removed: [], modified: [] });
  });

  it('returns an empty diff when either snapshot is absent', () => {
    expect([
      diffParkedMarkers(
        { exists: false, markers: {} },
        { exists: true, markers: { feature: 'parked by operator\n' } },
      ),
      diffParkedMarkers(
        { exists: true, markers: { feature: 'parked by operator\n' } },
        { exists: false, markers: {} },
      ),
    ]).toEqual([
      { added: [], removed: [], modified: [] },
      { added: [], removed: [], modified: [] },
    ]);
  });
});
