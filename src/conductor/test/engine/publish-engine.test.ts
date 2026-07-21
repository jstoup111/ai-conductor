import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, chmod, lstat, readlink, utimes } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { assertPublishWrapperEnv, publish } from '../../scripts/publish-engine.mjs';

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

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — self-guard env (CONDUCT_ENGINE_SELF_GUARD /
// CONDUCT_ENGINE_SELF_VERSION) threaded from publish-engine.mjs into the
// gcVersions call as `protectVersionIds`, fail-closed skip when the guard
// is set but the self version is unresolved.
// ─────────────────────────────────────────────────────────────────────────────

describe('publish-engine.mjs GC self-guard env', () => {
  const OLD_ISO_DATE = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

  /**
   * Seed `conductorRoot/dist-versions/` with `count` old, GC-eligible
   * version dirs (valid EngineVersionId format, aged past the 24h default
   * min-age, mtime set explicitly so age doesn't depend on wall-clock
   * timing). Returns the seeded ids, oldest first.
   */
  async function seedOldVersions(count: number): Promise<string[]> {
    const versionsDir = join(conductorRoot, 'dist-versions');
    await mkdir(versionsDir, { recursive: true });
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const ts = new Date(OLD_ISO_DATE.getTime() - (count - i) * 1000);
      const stamp = ts.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const id = `${stamp}-${String(i).padStart(12, '0')}`;
      const dir = join(versionsDir, id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.js'), `export const seeded = ${i};\n`, 'utf-8');
      await utimes(dir, ts, ts);
      ids.push(id);
    }
    return ids;
  }

  function runPublishWithEnv(env: NodeJS.ProcessEnv) {
    return execa(
      'node',
      [
        SCRIPT,
        '--conductor-root',
        conductorRoot,
        '--tsup-cmd',
        JSON.stringify(['node', stubPath]),
      ],
      {
        reject: false,
        env: {
          ...process.env,
          // Isolate from the real ~/.ai-conductor registry so GC's
          // live-referenced check sees an empty (non-existent) registry.
          AI_CONDUCTOR_REGISTRY: join(conductorRoot, 'no-such-registry.json'),
          ...env,
        },
      },
    );
  }

  it('with CONDUCT_ENGINE_SELF_GUARD=1 and a resolved self version, gcVersions protects that version from deletion', async () => {
    // 5 old, otherwise-GC-eligible versions; keepLastK defaults to 3 and
    // counts the newly-published version too, so without the guard the 2
    // oldest of these 5 would be deleted (5 old + 1 new = 6 total, newest 3
    // kept => 3 old survive by keepLastK, 2 old are eligible for deletion).
    const oldIds = await seedOldVersions(5);
    const selfVersion = oldIds[0]; // the oldest — would be deleted first without the guard

    const result = await runPublishWithEnv({
      CONDUCT_ENGINE_SELF_GUARD: '1',
      CONDUCT_ENGINE_SELF_VERSION: selfVersion,
    });

    expect(result.exitCode).toBe(0);
    const remaining = await readdir(join(conductorRoot, 'dist-versions'));
    expect(remaining).toContain(selfVersion);
  });

  it('with CONDUCT_ENGINE_SELF_GUARD=1 and an empty self version, GC is skipped entirely (zero deletions) and logs the reason', async () => {
    const oldIds = await seedOldVersions(5);

    const result = await runPublishWithEnv({
      CONDUCT_ENGINE_SELF_GUARD: '1',
      CONDUCT_ENGINE_SELF_VERSION: '',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('gc: skipped (self-guard, unresolved self version)');

    // Nothing was deleted — every seeded old version, plus the freshly
    // published one, is still present.
    const remaining = await readdir(join(conductorRoot, 'dist-versions'));
    for (const id of oldIds) {
      expect(remaining).toContain(id);
    }
    // Task 7: explicit zero-deletions assertion — without the guard,
    // keepLastK=3 would have deleted 2 of the 5 seeded old versions (see
    // the resolved-self-version test above), so exact-count equality here
    // is the assertion that distinguishes "skipped" from "still mostly ran".
    expect(remaining.length).toBe(oldIds.length + 1);
  });

  it('with CONDUCT_ENGINE_SELF_GUARD unset, GC behaves exactly as before (backward compatible)', async () => {
    const oldIds = await seedOldVersions(5);

    const result = await runPublishWithEnv({});

    expect(result.exitCode).toBe(0);
    const remaining = await readdir(join(conductorRoot, 'dist-versions'));
    // keepLastK=3 counts the new publish + the 2 newest old ones; the 3
    // oldest seeded versions are GC-eligible and should be gone.
    expect(remaining).not.toContain(oldIds[0]);
    expect(remaining).not.toContain(oldIds[1]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 6 — end-to-end: a long-lived daemon's version (`V_run`), seeded
  // outside keepLastK with NO live pidfile referencing it (simulating the
  // pre-`holdLock` startup window / a cross-context registry read — see
  // plan Verified gap), survives a real publish+GC pass when the self-guard
  // env points at it, and its directory remains fully readable afterward
  // (no ENOENT) — proving Tasks 1/3/4 hold end-to-end, not just in
  // isolation.
  // ───────────────────────────────────────────────────────────────────────

  it('protects a long-lived daemon version (no live pidfile) through a real publish+GC pass, and its files remain readable after', async () => {
    const oldIds = await seedOldVersions(5);
    const vRun = oldIds[0]; // oldest — outside keepLastK=3, GC-eligible, no pidfile references it

    // RED demonstration: with the guard disabled, this exact scenario
    // deletes V_run (no pidfile protection, no self-guard) — confirming the
    // guard is what saves it below, not some other retention rule.
    const redProbe = await runPublishWithEnv({});
    const redRemaining = await readdir(join(conductorRoot, 'dist-versions'));
    expect(redProbe.exitCode).toBe(0);
    expect(redRemaining).not.toContain(vRun);

    // Reset: re-seed a fresh conductorRoot scenario for the GREEN (guarded) run.
    await rm(conductorRoot, { recursive: true, force: true });
    conductorRoot = await mkdtemp(join(tmpdir(), 'publish-engine-test-'));
    stubPath = join(conductorRoot, 'stub-tsup.mjs');
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
    const oldIds2 = await seedOldVersions(5);
    const vRun2 = oldIds2[0];

    const guardedResult = await runPublishWithEnv({
      CONDUCT_ENGINE_SELF_GUARD: '1',
      CONDUCT_ENGINE_SELF_VERSION: vRun2,
    });
    expect(guardedResult.exitCode).toBe(0);

    const remaining = await readdir(join(conductorRoot, 'dist-versions'));
    expect(remaining).toContain(vRun2);

    // Readback: the protected version's directory is not just present on
    // disk but actually readable — no ENOENT reading its contents, the
    // real-world consequence of the self-eviction bug (#673).
    const vRunDir = join(conductorRoot, 'dist-versions', vRun2);
    const files = await readdir(vRunDir);
    expect(files).toContain('index.js');
    const contents = await readFile(join(vRunDir, 'index.js'), 'utf-8');
    expect(contents).toContain('seeded = 0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — pre-build source-cache skip + `.engine-source-key` sidecar
// persistence. Plan ref: .docs/plans/engine-rebuild-content-cache.md, Design
// "Pre-build skip" + "Sidecar record", Task 2.
//
// These tests call `publish()` directly (rather than through the CLI
// subprocess harness used above) so they can inject the `computeSourceKey`
// test seam, which has no CLI flag — mirroring how `publish-interrupted.test.ts`
// injects `simulateCrashAfterFinalize` directly.
// ─────────────────────────────────────────────────────────────────────────────

describe('publish-engine.mjs pre-build source-cache skip (Task 2)', () => {
  function makeCountingRunCommand() {
    let calls = 0;
    const runCommand = async (cmd: string[], execOpts: { cwd: string }) => {
      calls += 1;
      const [, scriptPath] = cmd;
      const outDirIdx = cmd.indexOf('--out-dir');
      const outDir = cmd[outDirIdx + 1];
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.js'), 'export const built = true;\n', 'utf-8');
      void scriptPath;
      void execOpts;
    };
    return { runCommand, getCalls: () => calls };
  }

  it('two publishes with an unchanged injected source key: 2nd build invoked 0 times, no staging dir, dist unchanged, same versionId, distinct log line', async () => {
    const { runCommand, getCalls } = makeCountingRunCommand();
    const computeSourceKey = async () => 'stable-source-key';

    const first = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    expect(getCalls()).toBe(1);

    const stderrLines: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      stderrLines.push(args.map(String).join(' '));
    };
    let second;
    try {
      second = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    } finally {
      console.error = origError;
    }

    expect(getCalls()).toBe(1); // still 1 — 2nd publish's build was skipped entirely
    expect(second.versionId).toBe(first.versionId);

    const rootEntries = await readdir(conductorRoot);
    expect(rootEntries.filter((name) => name.startsWith('.engine-staging-'))).toEqual([]);

    const target = await readlink(join(conductorRoot, 'dist'));
    expect(target).toBe(join('dist-versions', first.versionId));

    expect(stderrLines.some((line) => line.includes('engine source unchanged'))).toBe(true);
  });

  it('a first-ever publish writes .engine-source-key into the finalized version dir with the injected key value', async () => {
    const { runCommand } = makeCountingRunCommand();
    const computeSourceKey = async () => 'first-publish-key-value';

    const result = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });

    const sidecarPath = join(result.dir, '.engine-source-key');
    const sidecar = await readFile(sidecarPath, 'utf-8');
    expect(sidecar).toBe('first-publish-key-value');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — changed-source and fail-open rebuild paths. Plan ref:
// .docs/plans/engine-rebuild-content-cache.md, Design "Pre-build skip"
// steps 1-3, Task 3.
//
// Each test asserts the build IS invoked (rebuild happens, not skipped) in a
// case where a naive/buggy pre-build skip implementation would wrongly skip
// the build. Reuses the same direct-`publish()`-import harness as the Task 2
// skip tests above.
// ─────────────────────────────────────────────────────────────────────────────

describe('publish-engine.mjs changed-source / fail-open rebuild paths (Task 3)', () => {
  // Each call writes distinct build output (a per-call marker) so a real
  // rebuild always mints a genuinely new versionId — distinguishing "build
  // ran again and produced a fresh version" from the (also-legitimate but
  // orthogonal) output-content idempotence guard collapsing two builds with
  // *identical* output into the same version.
  function makeCountingRunCommand() {
    let calls = 0;
    const runCommand = async (cmd: string[], execOpts: { cwd: string }) => {
      calls += 1;
      const outDirIdx = cmd.indexOf('--out-dir');
      const outDir = cmd[outDirIdx + 1];
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.js'), `export const built = ${calls};\n`, 'utf-8');
      void execOpts;
    };
    return { runCommand, getCalls: () => calls };
  }

  it('rebuilds when the injected computeSourceKey differs from the recorded sidecar value', async () => {
    const { runCommand, getCalls } = makeCountingRunCommand();
    let key = 'key-one';
    const computeSourceKey = async () => key;

    const first = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    expect(getCalls()).toBe(1);

    key = 'key-two';
    const second = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });

    expect(getCalls()).toBe(2); // build invoked again — key mismatch
    expect(second.versionId).not.toBe(first.versionId);

    const target = await readlink(join(conductorRoot, 'dist'));
    expect(target).toBe(join('dist-versions', second.versionId));

    const sidecar = await readFile(join(second.dir, '.engine-source-key'), 'utf-8');
    expect(sidecar).toBe('key-two');
  });

  it('rebuilds and heals when the current version directory has been removed even though the key would match', async () => {
    const { runCommand, getCalls } = makeCountingRunCommand();
    const computeSourceKey = async () => 'stable-key';

    const first = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    expect(getCalls()).toBe(1);

    // Dangling `current`: the version dir the symlink points at is gone.
    await rm(first.dir, { recursive: true, force: true });

    const second = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });

    expect(getCalls()).toBe(2); // build invoked again — current dir missing
    expect(second.versionId).not.toBe(first.versionId);

    const target = await readlink(join(conductorRoot, 'dist'));
    expect(target).toBe(join('dist-versions', second.versionId));
    await expect(lstat(second.dir)).resolves.toBeDefined();
  });

  it('rebuilds when the current version directory exists but has no .engine-source-key sidecar at all', async () => {
    const { runCommand, getCalls } = makeCountingRunCommand();
    const computeSourceKey = async () => 'stable-key';

    const first = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    expect(getCalls()).toBe(1);

    // Simulate a version published before the sidecar existed / a corrupted
    // finalize that never wrote it.
    await rm(join(first.dir, '.engine-source-key'), { force: true });

    const second = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });

    expect(getCalls()).toBe(2); // build invoked again — no sidecar to compare against
    expect(second.versionId).not.toBe(first.versionId);
  });

  it.each([
    ['empty file', ''],
    ['garbage content', '\x00not-a-plausible-key\x00\n\n'],
  ])('rebuilds when the sidecar is corrupt/empty (%s)', async (_label, corruptContents) => {
    const { runCommand, getCalls } = makeCountingRunCommand();
    const computeSourceKey = async () => 'stable-key';

    const first = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    expect(getCalls()).toBe(1);

    await writeFile(join(first.dir, '.engine-source-key'), corruptContents, 'utf-8');

    const second = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });

    expect(getCalls()).toBe(2); // build invoked again — recorded key isn't a plausible match
    expect(second.versionId).not.toBe(first.versionId);
  });

  it('fails open: rebuilds and completes publish successfully when the injected computeSourceKey throws', async () => {
    const { runCommand, getCalls } = makeCountingRunCommand();
    const computeSourceKey = async () => 'stable-key';

    const first = await publish({ conductorRoot, tsupCommand: ['node', stubPath], runCommand, computeSourceKey });
    expect(getCalls()).toBe(1);

    const throwingComputeSourceKey = async () => {
      throw new Error('boom: source-key computation exploded');
    };

    const stderrLines: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      stderrLines.push(args.map(String).join(' '));
    };
    let second;
    try {
      second = await publish({
        conductorRoot,
        tsupCommand: ['node', stubPath],
        runCommand,
        computeSourceKey: throwingComputeSourceKey,
      });
    } finally {
      console.error = origError;
    }

    // publish() resolved normally — did not reject/throw.
    expect(second).toBeDefined();
    expect(getCalls()).toBe(2); // build invoked again — fail open on a throwing computeSourceKey
    expect(second.versionId).not.toBe(first.versionId);

    const target = await readlink(join(conductorRoot, 'dist'));
    expect(target).toBe(join('dist-versions', second.versionId));

    expect(stderrLines.some((line) => line.includes('source-key computation failed'))).toBe(true);

    // The sidecar for the freshly-built version is best-effort and uses the
    // (working) injected computeSourceKey passed to publish() for THIS call
    // at sidecar-write time — but that same throwing fn is reused, so the
    // write should fail non-fatally without failing the publish overall.
    await expect(lstat(join(second.dir, '.engine-source-key'))).rejects.toBeDefined();
  });
});

describe('package.json build script', () => {
  it('points at the publish-engine.mjs wrapper, not raw tsup', async () => {
    const pkgRaw = await readFile(join(process.cwd(), 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    expect(pkg.scripts.build).toMatch(/publish-engine\.mjs/);
  });
});
