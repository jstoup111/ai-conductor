import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, chmod, lstat, readlink } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { assertPublishWrapperEnv } from '../../scripts/publish-engine.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for scripts/publish-engine.mjs (Task 2, Phase 1 — FR-13 happy:
// "publish flow is staging -> finalize").
//
// Covers: publish builds into a staging dir, the finalized dir appears
// under `dist-versions/<id>/`, and staging is removed. The real `tsup`
// binary is never invoked — a stub build command is injected via the
// `--tsup-cmd` CLI flag (JSON array), which is the documented test seam.
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT = join(process.cwd(), 'scripts', 'publish-engine.mjs');

let conductorRoot: string;
let stubPath: string;

beforeEach(async () => {
  conductorRoot = await mkdtemp(join(tmpdir(), 'publish-engine-test-'));
  stubPath = join(conductorRoot, 'stub-tsup.mjs');
  // A stub "build": reads --out-dir from argv, writes one file into it,
  // and exits 0. Standing in for a real tsup invocation.
  await writeFile(
    stubPath,
    [
      'import { writeFile, mkdir } from "node:fs/promises";',
      'const args = process.argv.slice(2);',
      'const outDirIdx = args.indexOf("--out-dir");',
      'const outDir = args[outDirIdx + 1];',
      'await mkdir(outDir, { recursive: true });',
      'await writeFile(`${outDir}/index.js`, "export const built = true;\\n");',
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterEach(async () => {
  await rm(conductorRoot, { recursive: true, force: true });
});

function runPublish(extraArgs: string[] = []) {
  return execa(
    'node',
    [
      SCRIPT,
      '--conductor-root',
      conductorRoot,
      '--tsup-cmd',
      JSON.stringify(['node', stubPath]),
      ...extraArgs,
    ],
    { reject: false },
  );
}

describe('publish-engine.mjs', () => {
  it('builds into a staging dir, finalizes it under dist-versions/<id>/, and removes staging', async () => {
    const result = await runPublish();

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.versionId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/);
    expect(output.dir).toBe(join(conductorRoot, 'dist-versions', output.versionId));

    // Finalized dir exists and contains the built file.
    const finalizedFiles = await readdir(output.dir);
    expect(finalizedFiles).toContain('index.js');
    const contents = await readFile(join(output.dir, 'index.js'), 'utf-8');
    expect(contents).toContain('built = true');

    // No staging dir left behind under conductorRoot.
    const rootEntries = await readdir(conductorRoot);
    const stagingLeftovers = rootEntries.filter((name) => name.startsWith('.engine-staging-'));
    expect(stagingLeftovers).toEqual([]);
  });

  it('re-publishing identical content is a no-op: same versionId, one snapshot, dist untouched (#303)', async () => {
    const first = await runPublish();
    expect(first.exitCode).toBe(0);
    const v1 = JSON.parse(first.stdout).versionId;

    const second = await runPublish();
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).versionId).toBe(v1);
    expect(second.stderr).toContain('publish skipped');

    // Exactly one snapshot on disk; dist still points at it (relative target).
    expect(await readdir(join(conductorRoot, 'dist-versions'))).toEqual([v1]);
    expect(await readlink(join(conductorRoot, 'dist'))).toBe(join('dist-versions', v1));

    // No staging leftovers from the skipped publish.
    const rootEntries = await readdir(conductorRoot);
    expect(rootEntries.filter((name) => name.startsWith('.engine-staging-'))).toEqual([]);
  });

  it('changed content still publishes: new snapshot minted and dist flipped (negative path for the no-op guard)', async () => {
    const first = await runPublish();
    expect(first.exitCode).toBe(0);
    const v1 = JSON.parse(first.stdout).versionId;

    // Change what the "build" emits — content hash must differ.
    await writeFile(
      stubPath,
      [
        'import { writeFile, mkdir } from "node:fs/promises";',
        'const args = process.argv.slice(2);',
        'const outDir = args[args.indexOf("--out-dir") + 1];',
        'await mkdir(outDir, { recursive: true });',
        'await writeFile(`${outDir}/index.js`, "export const built = 2;\\n");',
        '',
      ].join('\n'),
      'utf-8',
    );

    const second = await runPublish();
    expect(second.exitCode).toBe(0);
    const v2 = JSON.parse(second.stdout).versionId;
    expect(v2).not.toBe(v1);
    expect(await readlink(join(conductorRoot, 'dist'))).toBe(join('dist-versions', v2));
  });

  it('removes the staging dir and exits non-zero when the build command fails', async () => {
    const failingStub = join(conductorRoot, 'failing-stub.mjs');
    await writeFile(failingStub, 'process.exit(1);\n', 'utf-8');

    const result = await execa(
      'node',
      [
        SCRIPT,
        '--conductor-root',
        conductorRoot,
        '--tsup-cmd',
        JSON.stringify(['node', failingStub]),
      ],
      { reject: false },
    );

    expect(result.exitCode).not.toBe(0);

    const rootEntries = await readdir(conductorRoot);
    const stagingLeftovers = rootEntries.filter((name) => name.startsWith('.engine-staging-'));
    expect(stagingLeftovers).toEqual([]);
    const distVersionsExists = rootEntries.includes('dist-versions');
    expect(distVersionsExists).toBe(false);
  });

  it('honors AI_CONDUCTOR_ENGINE_STORE to finalize under an overridden store root', async () => {
    const customStore = await mkdtemp(join(tmpdir(), 'publish-engine-store-'));
    try {
      const result = await execa(
        'node',
        [SCRIPT, '--conductor-root', conductorRoot, '--tsup-cmd', JSON.stringify(['node', stubPath])],
        {
          reject: false,
          env: { ...process.env, AI_CONDUCTOR_ENGINE_STORE: customStore },
        },
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.dir).toBe(join(customStore, output.versionId));
      const finalizedFiles = await readdir(output.dir);
      expect(finalizedFiles).toContain('index.js');
    } finally {
      await rm(customStore, { recursive: true, force: true });
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 4 (FR-13 neg): migration of a legacy real `dist/` dir + guard
  // against invoking raw tsup against the live layout.
  // ───────────────────────────────────────────────────────────────────────

  it('migrates a real legacy dist/ dir to dist-versions/<id>/ + symlink before publishing', async () => {
    // Simulate a pre-existing plain `dist/` directory (legacy, pre-versioning
    // layout) with real build output in it.
    const legacyDist = join(conductorRoot, 'dist');
    await mkdir(legacyDist, { recursive: true });
    await writeFile(join(legacyDist, 'index.js'), 'export const legacy = true;\n', 'utf-8');
    await writeFile(join(legacyDist, 'index.d.ts'), 'export declare const legacy: boolean;\n', 'utf-8');

    const preMigrationStat = await lstat(legacyDist);
    expect(preMigrationStat.isSymbolicLink()).toBe(false);
    expect(preMigrationStat.isDirectory()).toBe(true);

    const result = await runPublish();
    expect(result.exitCode).toBe(0);

    // dist is now a symlink...
    const distStat = await lstat(legacyDist);
    expect(distStat.isSymbolicLink()).toBe(true);

    // ...and the legacy content was preserved under dist-versions/<migrated-id>/
    // (distinct from the new publish's version dir).
    const versionsDir = join(conductorRoot, 'dist-versions');
    const versionEntries = await readdir(versionsDir);
    expect(versionEntries.length).toBeGreaterThanOrEqual(2);

    let migratedDir: string | undefined;
    for (const entry of versionEntries) {
      const entryPath = join(versionsDir, entry);
      const files = await readdir(entryPath);
      if (files.includes('index.js')) {
        const contents = await readFile(join(entryPath, 'index.js'), 'utf-8');
        if (contents.includes('legacy = true')) {
          migratedDir = entry;
        }
      }
    }
    expect(migratedDir).toBeDefined();

    // The symlink now points at the *new* publish's version dir, not the
    // migrated legacy one (the normal publish flow ran after migration).
    const output = JSON.parse(result.stdout);
    const target = await readlink(legacyDist);
    expect(resolve(dirname(legacyDist), target)).toBe(resolve(output.dir));
    expect(migratedDir).not.toBe(output.versionId);
  });

  it('is idempotent: migration only happens once, subsequent publishes do not re-migrate', async () => {
    const legacyDist = join(conductorRoot, 'dist');
    await mkdir(legacyDist, { recursive: true });
    await writeFile(join(legacyDist, 'index.js'), 'export const legacy = true;\n', 'utf-8');

    const first = await runPublish();
    expect(first.exitCode).toBe(0);

    const countLegacyDirs = async () => {
      const versionsDir = join(conductorRoot, 'dist-versions');
      const entries = await readdir(versionsDir);
      let count = 0;
      for (const entry of entries) {
        const files = await readdir(join(versionsDir, entry));
        if (!files.includes('index.js')) continue;
        const contents = await readFile(join(versionsDir, entry, 'index.js'), 'utf-8');
        if (contents.includes('legacy = true')) count += 1;
      }
      return count;
    };

    expect(await countLegacyDirs()).toBe(1);

    // dist is now a symlink — a second publish must NOT treat it as a
    // legacy plain directory again (no second migration of the same
    // content). Use a stub with different output content so its version id
    // doesn't collide with the first publish's (ids are content-addressed;
    // identical content within the same second produces identical ids).
    const stubPath2 = join(conductorRoot, 'stub-tsup-2.mjs');
    await writeFile(
      stubPath2,
      [
        'import { writeFile, mkdir } from "node:fs/promises";',
        'const args = process.argv.slice(2);',
        'const outDirIdx = args.indexOf("--out-dir");',
        'const outDir = args[outDirIdx + 1];',
        'await mkdir(outDir, { recursive: true });',
        'await writeFile(`${outDir}/index.js`, "export const built = 2;\\n");',
        '',
      ].join('\n'),
      'utf-8',
    );
    const second = await execa(
      'node',
      [
        SCRIPT,
        '--conductor-root',
        conductorRoot,
        '--tsup-cmd',
        JSON.stringify(['node', stubPath2]),
      ],
      { reject: false },
    );
    expect(second.exitCode).toBe(0);

    expect(await countLegacyDirs()).toBe(1);
  });
});

describe('assertPublishWrapperEnv (raw tsup guard)', () => {
  it('throws an actionable error when the wrapper marker env var is absent', () => {
    expect(() => assertPublishWrapperEnv({})).toThrow(/npm run build/i);
  });

  it('does not throw when the wrapper marker env var is present', () => {
    expect(() => assertPublishWrapperEnv({ AI_CONDUCTOR_PUBLISH_WRAPPER: '1' })).not.toThrow();
  });
});

describe('package.json build script', () => {
  it('points at the publish-engine.mjs wrapper, not raw tsup', async () => {
    const pkgRaw = await readFile(join(process.cwd(), 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    expect(pkg.scripts.build).toMatch(/publish-engine\.mjs/);
  });
});
