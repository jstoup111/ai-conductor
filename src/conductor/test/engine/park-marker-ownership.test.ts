// Covers: task:4, task:rem-as-built-rem-as-built-r7
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOwnedPark,
  getProvenanceType,
  isOperatorParked,
  releaseOwnedPark,
  writeOperatorPark,
} from '../../src/engine/park-marker';

const releaseRace = vi.hoisted(() => ({
  recreateMarker: undefined as undefined | (() => Promise<void>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async rm(...args: Parameters<typeof actual.rm>) {
      const recreateMarker = releaseRace.recreateMarker;
      if (recreateMarker) {
        releaseRace.recreateMarker = undefined;
        await recreateMarker();
      }
      return actual.rm(...args);
    },
  };
});

let repositoryRoot: string;

function markerPath(slug = 'demo'): string {
  return join(repositoryRoot, '.daemon', 'parked', slug);
}

beforeEach(async () => {
  repositoryRoot = await mkdtemp(join(tmpdir(), 'park-marker-ownership-'));
});

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true });
});

describe('owned park markers (Task 4)', () => {
  it('returns a fresh branded token only to the creator and leaves an existing marker untouched', async () => {
    const created = await createOwnedPark(repositoryRoot, 'demo');

    expect(created.created).toBe(true);
    if (!created.created) throw new Error('expected fresh owned park');
    expect(created.token).toMatch(/^[0-9a-f-]{36}$/i);
    const original = await readFile(markerPath(), 'utf8');

    await expect(createOwnedPark(repositoryRoot, 'demo')).resolves.toEqual({ created: false });
    await expect(readFile(markerPath(), 'utf8')).resolves.toBe(original);
  });

  it('has exactly one creator when two callers create the same marker concurrently', async () => {
    const results = await Promise.all([
      createOwnedPark(repositoryRoot, 'demo'),
      createOwnedPark(repositoryRoot, 'demo'),
    ]);

    const creators = results.filter((result) => result.created);
    expect(creators).toHaveLength(1);
    expect(creators[0]?.token).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('releases its own marker', async () => {
    const first = await createOwnedPark(repositoryRoot, 'demo');
    if (!first.created) throw new Error('expected first owned park');

    await releaseOwnedPark(repositoryRoot, 'demo', first.token);

    await expect(isOperatorParked(repositoryRoot, 'demo')).resolves.toBe(false);
  });

  it('preserves a marker with a different token or one recreated by daemon park', async () => {
    const first = await createOwnedPark(repositoryRoot, 'demo');
    if (!first.created) throw new Error('expected first owned park');
    await releaseOwnedPark(repositoryRoot, 'demo', first.token);

    const recreated = await createOwnedPark(repositoryRoot, 'demo');
    if (!recreated.created) throw new Error('expected recreated owned park');
    const replacementWithOtherToken = await readFile(markerPath(), 'utf8');

    await releaseOwnedPark(repositoryRoot, 'demo', first.token);

    await expect(readFile(markerPath(), 'utf8')).resolves.toBe(replacementWithOtherToken);
    await releaseOwnedPark(repositoryRoot, 'demo', recreated.token);

    await writeOperatorPark(repositoryRoot, 'demo');
    const daemonParkMarker = await readFile(markerPath(), 'utf8');
    await releaseOwnedPark(repositoryRoot, 'demo', recreated.token);

    await expect(readFile(markerPath(), 'utf8')).resolves.toBe(daemonParkMarker);
    await expect(isOperatorParked(repositoryRoot, 'demo')).resolves.toBe(true);
  });

  it('preserves a marker recreated after ownership is read and before its delete', async () => {
    const owned = await createOwnedPark(repositoryRoot, 'demo');
    if (!owned.created) throw new Error('expected owned park');

    releaseRace.recreateMarker = async () => {
      await unlink(markerPath());
      await writeOperatorPark(repositoryRoot, 'demo');
    };

    await releaseOwnedPark(repositoryRoot, 'demo', owned.token);

    await expect(isOperatorParked(repositoryRoot, 'demo')).resolves.toBe(true);
  });

  it('is parked with operator provenance', async () => {
    const created = await createOwnedPark(repositoryRoot, 'demo');
    if (!created.created) throw new Error('expected fresh owned park');

    await expect(isOperatorParked(repositoryRoot, 'demo')).resolves.toBe(true);
    await expect(getProvenanceType(repositoryRoot, 'demo')).resolves.toBe('operator');
    await expect(readFile(markerPath(), 'utf8')).resolves.not.toMatch(/^auto-parked:/);
  });
});
