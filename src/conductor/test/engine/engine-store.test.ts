import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink, lstat, readlink } from 'fs/promises';
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

describe('computeEngineSourceKey', () => {
  async function makeFixtureTree(root: string): Promise<void> {
    await mkdir(join(root, 'src', 'nested'), { recursive: true });
    await mkdir(join(root, 'scripts'), { recursive: true });
    await writeFile(join(root, 'src', 'index.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'src', 'nested', 'util.ts'), 'export const b = 2;\n');
    await writeFile(join(root, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
    await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n');
    await writeFile(join(root, 'tsup.config.ts'), 'export default {};\n');
    await writeFile(join(root, 'scripts', 'publish-guard.mjs'), 'export const guard = 1;\n');
    // A file outside the defined input set — must not affect the key.
    await writeFile(join(root, 'README.md'), '# hello\n');
  }

  it('is deterministic across two calls on the same fixture tree', async () => {
    const { computeEngineSourceKey } = await loadEngineStore();
    await makeFixtureTree(tmpDir);

    const keyA = await computeEngineSourceKey({ conductorRoot: tmpDir });
    const keyB = await computeEngineSourceKey({ conductorRoot: tmpDir });

    expect(keyA).toBe(keyB);
    expect(keyA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a src file byte changes', async () => {
    const { computeEngineSourceKey } = await loadEngineStore();
    await makeFixtureTree(tmpDir);
    const before = await computeEngineSourceKey({ conductorRoot: tmpDir });

    await writeFile(join(tmpDir, 'src', 'index.ts'), 'export const a = 2;\n');
    const after = await computeEngineSourceKey({ conductorRoot: tmpDir });

    expect(after).not.toBe(before);
  });

  it('changes when the lockfile changes', async () => {
    const { computeEngineSourceKey } = await loadEngineStore();
    await makeFixtureTree(tmpDir);
    const before = await computeEngineSourceKey({ conductorRoot: tmpDir });

    await writeFile(join(tmpDir, 'package-lock.json'), '{"lockfileVersion":4}\n');
    const after = await computeEngineSourceKey({ conductorRoot: tmpDir });

    expect(after).not.toBe(before);
  });

  it('does not change when a file outside the defined input set changes', async () => {
    const { computeEngineSourceKey } = await loadEngineStore();
    await makeFixtureTree(tmpDir);
    const before = await computeEngineSourceKey({ conductorRoot: tmpDir });

    await writeFile(join(tmpDir, 'README.md'), '# updated\n');
    await writeFile(join(tmpDir, 'unrelated.txt'), 'irrelevant\n');
    const after = await computeEngineSourceKey({ conductorRoot: tmpDir });

    expect(after).toBe(before);
  });
});

describe('flipCurrent', () => {
  async function makeVersionDir(versionId: string): Promise<string> {
    const versionDir = join(tmpDir, 'dist-versions', versionId);
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, 'index.js'), 'console.log(1);\n');
    return versionDir;
  }

  it('flips dist to a symlink pointing at the new version dir', async () => {
    const { flipCurrent, currentTarget } = await loadEngineStore();
    const versionId = '20260704T120000Z-aaaaaaaaaaaa' as Awaited<
      ReturnType<typeof flipCurrent>
    >;
    await makeVersionDir(versionId);

    const result = await flipCurrent({ conductorRoot: tmpDir, versionId });

    expect(result).toBe(versionId);
    const distPath = join(tmpDir, 'dist');
    const stat = await lstat(distPath);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(await currentTarget(tmpDir)).toBe(versionId);
  });

  it('flips via symlink-tmp + rename (no lingering tmp entries, dist never absent)', async () => {
    const { flipCurrent } = await loadEngineStore();
    const versionIdA = '20260704T110000Z-aaaaaaaaaaaa' as Awaited<
      ReturnType<typeof flipCurrent>
    >;
    const versionIdB = '20260704T120000Z-bbbbbbbbbbbb' as Awaited<
      ReturnType<typeof flipCurrent>
    >;
    await makeVersionDir(versionIdA);
    await makeVersionDir(versionIdB);

    await flipCurrent({ conductorRoot: tmpDir, versionId: versionIdA });
    const distPath = join(tmpDir, 'dist');

    // Race a second flip against repeated existence checks on `dist`: at no
    // observed point should `dist` be missing (rename is atomic, so a poll
    // loop can never catch it absent).
    let sawMissing = false;
    const poll = (async () => {
      for (let i = 0; i < 200; i += 1) {
        try {
          await lstat(distPath);
        } catch {
          sawMissing = true;
          break;
        }
      }
    })();

    await Promise.all([poll, flipCurrent({ conductorRoot: tmpDir, versionId: versionIdB })]);

    expect(sawMissing).toBe(false);

    // No stray tmp symlinks left behind under conductorRoot.
    const { readdir } = await import('fs/promises');
    const entries = await readdir(tmpDir);
    const tmpEntries = entries.filter((name) => name.startsWith('.dist-tmp-'));
    expect(tmpEntries).toEqual([]);

    // Target must be RELATIVE: `dist` may be committed, and an absolute target
    // dangles in every other clone/checkout (see flipCurrent).
    const finalTarget = await readlink(distPath);
    expect(finalTarget).toBe(join('dist-versions', versionIdB));
  });

  it('never rewrites published version dirs (mtime snapshot unchanged after flip)', async () => {
    const { flipCurrent } = await loadEngineStore();
    const versionId = '20260704T120000Z-cccccccccccc' as Awaited<
      ReturnType<typeof flipCurrent>
    >;
    const versionDir = await makeVersionDir(versionId);
    const beforeStat = await lstat(versionDir);

    await flipCurrent({ conductorRoot: tmpDir, versionId });

    const afterStat = await lstat(versionDir);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.ctimeMs).toBe(beforeStat.ctimeMs);
  });

  it('throws when the target version id has not been published', async () => {
    const { flipCurrent } = await loadEngineStore();
    const versionId = '20260704T120000Z-dddddddddddd' as Awaited<
      ReturnType<typeof flipCurrent>
    >;

    await expect(flipCurrent({ conductorRoot: tmpDir, versionId })).rejects.toThrow();
  });
});
