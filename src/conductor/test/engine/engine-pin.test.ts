// Covers: task:2
// Per-dispatch engine pin resolution: resolve the floating dist link to an
// immutable version directory, or stay on the supervisor's own valid build.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { versionIdFromEngineDir } from '../../src/engine/engine-version-id.js';

const v1 = '20261019T120000Z-aaaaaaaaaaaa';
const v2 = '20261019T130000Z-bbbbbbbbbbbb';

async function loadEnginePin(): Promise<typeof import('../../src/engine/engine-pin.js')> {
  return import('../../src/engine/engine-pin.js');
}

let tmpDir: string;
let conductorRoot: string;
let ownEngineDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'engine-pin-test-'));
  conductorRoot = join(tmpDir, 'conductor');
  ownEngineDir = join(tmpDir, 'supervisor', 'dist-versions', v1);
  await mkdir(ownEngineDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function linkDist(target: string): Promise<void> {
  await mkdir(conductorRoot, { recursive: true });
  await symlink(relative(conductorRoot, target), join(conductorRoot, 'dist'));
}

async function makeVersion(storeRoot: string, versionId = v2): Promise<string> {
  const engineDir = join(storeRoot, versionId);
  await mkdir(engineDir, { recursive: true });
  return engineDir;
}

describe('resolveEnginePin', () => {
  it.each([
    ['the default store', () => join(conductorRoot, 'dist-versions')],
    ['an external AI_CONDUCTOR_ENGINE_STORE', () => join(tmpDir, 'external-store')],
  ])('pins dist to the v2 realpath from %s', async (_placement, storeFor) => {
    const { resolveEnginePin } = await loadEnginePin();
    const storeRoot = storeFor();
    const v2Dir = await makeVersion(storeRoot);
    await linkDist(v2Dir);

    const pin = await resolveEnginePin({ conductorRoot, storeRoot, ownEngineDir });

    expect(pin).toEqual({
      engineVersionId: v2,
      engineDir: await realpath(v2Dir),
      fallbackReason: undefined,
    });
    expect(versionIdFromEngineDir(pin.engineDir)).toBe(pin.engineVersionId);
  });

  it('falls back when dangling dist has a valid-id basename colliding with a store version', async () => {
    const { resolveEnginePin } = await loadEnginePin();
    const storeRoot = join(tmpDir, 'external-store');
    await makeVersion(storeRoot, v2);
    await linkDist(join(tmpDir, 'missing-store', v2));

    await expect(resolveEnginePin({ conductorRoot, storeRoot, ownEngineDir })).resolves.toEqual({
      engineVersionId: v1,
      engineDir: ownEngineDir,
      fallbackReason: 'dangling-dist',
    });
  });

  it.each([
    {
      name: 'a dangling dist symlink',
      setup: async (storeRoot: string) => linkDist(join(storeRoot, v2)),
      fallbackReason: 'dangling-dist',
    },
    {
      name: 'a publish-incomplete target',
      setup: async (storeRoot: string) => {
        const v2Dir = await makeVersion(storeRoot);
        await writeFile(join(v2Dir, '.publish-incomplete'), 'interrupted publish\n');
        await linkDist(v2Dir);
      },
      fallbackReason: 'publish-incomplete',
    },
    {
      name: 'a dist target without a parseable version id',
      setup: async (storeRoot: string) => {
        const unversionedDir = join(storeRoot, 'unversioned-build');
        await mkdir(unversionedDir, { recursive: true });
        await linkDist(unversionedDir);
      },
      fallbackReason: 'unparseable-version-id',
    },
  ])('falls back to the supervisor engine for $name', async ({ setup, fallbackReason }) => {
    const { resolveEnginePin } = await loadEnginePin();
    const storeRoot = join(tmpDir, 'external-store');
    await setup(storeRoot);

    const pin = await resolveEnginePin({ conductorRoot, storeRoot, ownEngineDir });

    expect(pin).toEqual({
      engineVersionId: v1,
      engineDir: ownEngineDir,
      fallbackReason,
    });
    expect(versionIdFromEngineDir(pin.engineDir)).toBe(pin.engineVersionId);
  });
});
