import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for src/engine/engine-store.ts (Task 1, Phase 1 — FR-13/FR-14).
//
// Covers the versioned engine store layout primitives:
//   - resolveEngineStoreRoot: AI_CONDUCTOR_ENGINE_STORE env override, else
//     `<conductorRoot>/dist-versions`.
//   - computeVersionId: timestamp+content-stamp format, unique on dirty trees
//     (same source dir, different content -> different id).
//   - listVersions: enumerates version dirs under the store root.
//   - currentTarget: resolves the `dist` symlink to the version id it targets.
// ─────────────────────────────────────────────────────────────────────────────

async function loadEngineStore(): Promise<typeof import('../../src/engine/engine-store.js')> {
  return import('../../src/engine/engine-store.js');
}

let tmpDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'engine-store-test-'));
  savedEnv.AI_CONDUCTOR_ENGINE_STORE = process.env.AI_CONDUCTOR_ENGINE_STORE;
  delete process.env.AI_CONDUCTOR_ENGINE_STORE;
});

afterEach(async () => {
  if (savedEnv.AI_CONDUCTOR_ENGINE_STORE === undefined) {
    delete process.env.AI_CONDUCTOR_ENGINE_STORE;
  } else {
    process.env.AI_CONDUCTOR_ENGINE_STORE = savedEnv.AI_CONDUCTOR_ENGINE_STORE;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe('resolveEngineStoreRoot', () => {
  it('defaults to <conductorRoot>/dist-versions when no env override is set', async () => {
    const { resolveEngineStoreRoot } = await loadEngineStore();
    const root = resolveEngineStoreRoot({ conductorRoot: tmpDir, env: {} });
    expect(root).toBe(join(tmpDir, 'dist-versions'));
  });

  it('honours AI_CONDUCTOR_ENGINE_STORE override over the default', async () => {
    const { resolveEngineStoreRoot } = await loadEngineStore();
    const override = join(tmpDir, 'custom-store');
    const root = resolveEngineStoreRoot({
      conductorRoot: tmpDir,
      env: { AI_CONDUCTOR_ENGINE_STORE: override },
    });
    expect(root).toBe(override);
  });

  it('falls back to process.env when no env arg is passed', async () => {
    const { resolveEngineStoreRoot } = await loadEngineStore();
    const override = join(tmpDir, 'from-process-env');
    process.env.AI_CONDUCTOR_ENGINE_STORE = override;
    const root = resolveEngineStoreRoot({ conductorRoot: tmpDir });
    expect(root).toBe(override);
  });
});

describe('computeVersionId', () => {
  it('formats as `<timestamp>-<contentStamp>`', async () => {
    const { computeVersionId } = await loadEngineStore();
    const srcDir = join(tmpDir, 'src-a');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'index.js'), 'console.log(1);\n');

    const id = await computeVersionId({ srcDir, now: new Date('2026-07-04T12:00:00.000Z') });

    expect(id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/);
  });

  it('is unique for dirty trees: same timestamp, different content -> different id', async () => {
    const { computeVersionId } = await loadEngineStore();
    const now = new Date('2026-07-04T12:00:00.000Z');

    const srcA = join(tmpDir, 'src-a');
    await mkdir(srcA, { recursive: true });
    await writeFile(join(srcA, 'index.js'), 'console.log(1);\n');

    const srcB = join(tmpDir, 'src-b');
    await mkdir(srcB, { recursive: true });
    await writeFile(join(srcB, 'index.js'), 'console.log(2);\n');

    const idA = await computeVersionId({ srcDir: srcA, now });
    const idB = await computeVersionId({ srcDir: srcB, now });

    expect(idA).not.toBe(idB);
  });

  it('is deterministic for identical content and timestamp', async () => {
    const { computeVersionId } = await loadEngineStore();
    const now = new Date('2026-07-04T12:00:00.000Z');

    const srcA = join(tmpDir, 'src-a');
    await mkdir(srcA, { recursive: true });
    await writeFile(join(srcA, 'index.js'), 'console.log(1);\n');

    const srcB = join(tmpDir, 'src-b');
    await mkdir(srcB, { recursive: true });
    await writeFile(join(srcB, 'index.js'), 'console.log(1);\n');

    const idA = await computeVersionId({ srcDir: srcA, now });
    const idB = await computeVersionId({ srcDir: srcB, now });

    expect(idA).toBe(idB);
  });
});

describe('listVersions', () => {
  it('returns [] when the store root does not exist', async () => {
    const { listVersions } = await loadEngineStore();
    const versions = await listVersions(join(tmpDir, 'does-not-exist'));
    expect(versions).toEqual([]);
  });

  it('lists version-id directories under the store root, sorted', async () => {
    const { listVersions } = await loadEngineStore();
    const root = join(tmpDir, 'dist-versions');
    await mkdir(join(root, '20260704T110000Z-aaaaaaaaaaaa'), { recursive: true });
    await mkdir(join(root, '20260704T120000Z-bbbbbbbbbbbb'), { recursive: true });

    const versions = await listVersions(root);

    expect(versions).toEqual([
      '20260704T110000Z-aaaaaaaaaaaa',
      '20260704T120000Z-bbbbbbbbbbbb',
    ]);
  });

  it('ignores non-directory entries under the store root', async () => {
    const { listVersions } = await loadEngineStore();
    const root = join(tmpDir, 'dist-versions');
    await mkdir(join(root, '20260704T110000Z-aaaaaaaaaaaa'), { recursive: true });
    await writeFile(join(root, 'stray-file.txt'), 'not a version dir');

    const versions = await listVersions(root);

    expect(versions).toEqual(['20260704T110000Z-aaaaaaaaaaaa']);
  });
});

describe('currentTarget', () => {
  it('returns undefined when the dist symlink does not exist', async () => {
    const { currentTarget } = await loadEngineStore();
    const result = await currentTarget(tmpDir);
    expect(result).toBeUndefined();
  });

  it('resolves the dist symlink to the version id it targets', async () => {
    const { currentTarget } = await loadEngineStore();
    const versionId = '20260704T120000Z-bbbbbbbbbbbb';
    const versionDir = join(tmpDir, 'dist-versions', versionId);
    await mkdir(versionDir, { recursive: true });
    await symlink(versionDir, join(tmpDir, 'dist'));

    const result = await currentTarget(tmpDir);

    expect(result).toBe(versionId);
  });

  it('returns undefined for a dangling dist symlink rather than throwing', async () => {
    const { currentTarget } = await loadEngineStore();
    const missingTarget = join(tmpDir, 'dist-versions', '20260704T120000Z-missing');
    await symlink(missingTarget, join(tmpDir, 'dist'));

    await expect(currentTarget(tmpDir)).resolves.toBeUndefined();
  });
});
