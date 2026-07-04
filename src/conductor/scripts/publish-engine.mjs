#!/usr/bin/env node
// Publish the engine: build into a STAGING dir, finalize the staging dir as
// an immutable `dist-versions/<version-id>/` directory, then atomically flip
// the `dist` symlink to point at it.
//
// Plan ref: .docs/plans/daemon-lifecycle-controls.md Phase 1 / Task 2 (FR-13
// happy: "publish flow is staging -> finalize") and Task 3 ("atomic current
// flip — never in-place"). The flip itself is `flipCurrent` in
// engine-store.ts — this script only orchestrates staging, finalize, and the
// flip call.
//
// Test seam: the real `tsup` build is never invoked by tests. The command
// used to "build" is resolvable via (in priority order):
//   1. the `tsupCommand` option passed to `publish()` directly (programmatic
//      callers / tests importing this module),
//   2. the `--tsup-cmd '["node","stub.mjs"]'` CLI flag (JSON array),
//   3. the `AI_CONDUCTOR_TSUP_CMD` env var (same JSON-array format),
//   4. the default: `['tsup']`.
// Whatever command runs, it is invoked with the staging dir appended as
// `--out-dir <stagingDir>` and must exit 0 on success.

import { execa } from 'execa';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLISH_WRAPPER_ENV_VAR, assertPublishWrapperEnv } from './publish-guard.mjs';

const DEFAULT_TSUP_COMMAND = ['tsup'];

// Re-exported so existing imports of `assertPublishWrapperEnv` from this
// module (e.g. tests) keep working; the canonical implementation lives in
// the shebang-free `publish-guard.mjs` (see that file for why).
export { PUBLISH_WRAPPER_ENV_VAR, assertPublishWrapperEnv };

/**
 * If `<conductorRoot>/dist` exists and is a *real* directory (not a
 * symlink), this is a legacy pre-versioning build output. Migrate it once:
 * move its contents into `dist-versions/<migrated-id>/` and leave `dist`
 * absent (the normal publish flow that runs immediately after will create
 * the fresh version + flip the symlink). Idempotent: once `dist` is a
 * symlink (or absent), this is a no-op.
 *
 * @param {{ conductorRoot: string, env: NodeJS.ProcessEnv, now?: Date,
 *   resolveEngineStoreRoot: Function, computeVersionId: Function }} opts
 */
async function migrateLegacyDistIfNeeded(opts) {
  const distPath = join(opts.conductorRoot, 'dist');

  let stat;
  try {
    stat = await lstat(distPath);
  } catch {
    return; // No dist/ at all — nothing to migrate.
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return; // Already a symlink (versioned layout) — nothing to do.
  }

  const storeRoot = opts.resolveEngineStoreRoot({ conductorRoot: opts.conductorRoot, env: opts.env });
  const migratedVersionId = await opts.computeVersionId({ srcDir: distPath, now: opts.now });
  await mkdir(storeRoot, { recursive: true });
  const migratedDir = join(storeRoot, migratedVersionId);
  await rename(distPath, migratedDir);
  console.error(
    `[publish-engine] migrated legacy dist/ -> dist-versions/${migratedVersionId}/`,
  );
}

// This script runs as a plain Node process BEFORE the engine has ever been
// built (chicken-and-egg: it IS the build), so it can't `import` the
// TypeScript source of `engine-store.ts` the normal way — there is no
// compiled `dist/` yet for a first publish, and the Node version this repo
// targets (>=20.5) has no built-in TS support. Rather than duplicate
// `resolveEngineStoreRoot`/`computeVersionId` as a second implementation
// that could drift from the real one, this loads the single source of
// truth directly: transpile `src/engine/engine-store.ts` with esbuild (an
// existing transitive dependency of `tsup`, already vendored in
// node_modules) and import the result. `engine-store.ts` now also imports
// its sibling `registry.ts` (Task 7, GC cross-checks the project registry),
// so this loader bundles rather than transforms-in-isolation — otherwise the
// emitted `.mjs` would `import` a `registry.js` that doesn't exist next to
// it. Bundling is still scoped to Node builtins only (no npm deps to
// externalize): both source files are self-contained.
async function loadEngineStore() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(scriptDir, '..', 'src', 'engine', 'engine-store.ts');

  const esbuild = await import('esbuild');
  const { outputFiles } = await esbuild.build({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
  });
  const code = outputFiles[0].text;

  const tmpFile = join(await mkdtemp(join(tmpdir(), 'engine-store-loader-')), 'engine-store.mjs');
  await writeFile(tmpFile, code, 'utf-8');
  try {
    return await import(pathToFileURL(tmpFile).href);
  } finally {
    await rm(dirname(tmpFile), { recursive: true, force: true });
  }
}

/**
 * @typedef {object} PublishOpts
 * @property {string} conductorRoot - the `src/conductor` package root.
 * @property {NodeJS.ProcessEnv} [env] - defaults to `process.env`.
 * @property {string[]} [tsupCommand] - overrides env/flag/default tsup invocation.
 * @property {Date} [now] - injectable build timestamp for `computeVersionId`.
 * @property {(cmd: string[], opts: { cwd: string }) => Promise<unknown>} [runCommand]
 *   - test seam replacing the underlying `execa` call entirely.
 */

/**
 * Resolve the command array used to run the "build" step, honoring the
 * priority order documented above.
 * @param {{ tsupCommand?: string[], env: NodeJS.ProcessEnv }} opts
 * @returns {string[]}
 */
function resolveTsupCommand(opts) {
  if (opts.tsupCommand && opts.tsupCommand.length > 0) return opts.tsupCommand;
  const raw = opts.env.AI_CONDUCTOR_TSUP_CMD;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`AI_CONDUCTOR_TSUP_CMD must be a non-empty JSON array, got: ${raw}`);
    }
    return parsed;
  }
  return DEFAULT_TSUP_COMMAND;
}

/**
 * Run the publish flow: build into a fresh staging dir under `conductorRoot`,
 * then finalize (rename) the staging dir into
 * `<storeRoot>/<version-id>/`. Staging is always removed — on success it's
 * removed by the rename itself (the source path no longer exists after a
 * rename); on failure it's removed explicitly before the error propagates.
 *
 * @param {PublishOpts} opts
 * @returns {Promise<{ versionId: string, dir: string }>}
 */
export async function publish(opts) {
  const env = opts.env ?? process.env;
  const conductorRoot = resolve(opts.conductorRoot);
  const { resolveEngineStoreRoot, computeVersionId, flipCurrent, gcVersions } = await loadEngineStore();
  const storeRoot = resolveEngineStoreRoot({ conductorRoot, env });

  await migrateLegacyDistIfNeeded({
    conductorRoot,
    env,
    now: opts.now,
    resolveEngineStoreRoot,
    computeVersionId,
  });

  const stagingParent = conductorRoot;
  const stagingDir = await mkdtemp(join(stagingParent, '.engine-staging-'));

  const runCommand =
    opts.runCommand ??
    (async (cmd, execOpts) => {
      const [bin, ...args] = cmd;
      await execa(bin, args, {
        cwd: execOpts.cwd,
        stdio: 'inherit',
        env: { ...process.env, [PUBLISH_WRAPPER_ENV_VAR]: '1' },
      });
    });

  try {
    const tsupCommand = resolveTsupCommand({ tsupCommand: opts.tsupCommand, env });
    await runCommand([...tsupCommand, '--out-dir', stagingDir], { cwd: conductorRoot });

    const versionId = await computeVersionId({ srcDir: stagingDir, now: opts.now });
    await mkdir(storeRoot, { recursive: true });
    const finalDir = join(storeRoot, versionId);
    await rename(stagingDir, finalDir);

    await flipCurrent({ conductorRoot, versionId, env });

    // GC old versions (Task 7, FR-15). Safety-critical + fail-closed by
    // design: `gcVersions` itself never deletes on an erroring read (registry
    // enumeration failure, an unreadable fleet pidfile) — it warns and
    // returns zero deletions instead. Belt-and-braces: any *unexpected*
    // throw out of `gcVersions` is also caught here so a GC hiccup never
    // turns a successful publish into a failed one (exit 0 either way).
    try {
      const { deletedCount } = await gcVersions({ conductorRoot, currentVersionId: versionId, env });
      if (deletedCount > 0) {
        console.error(`[publish-engine] gc: deleted ${deletedCount} old version(s)`);
      }
    } catch (err) {
      console.error(
        `[publish-engine] gc: skipped (unexpected error): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { versionId, dir: finalDir };
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true });
    throw err;
  }
}

/** True when this module is being run directly (`node scripts/publish-engine.mjs`). */
function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

/**
 * Minimal CLI arg parsing: `--conductor-root <path>` and
 * `--tsup-cmd '<json array>'`. Both optional.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ conductorRoot?: string, tsupCommand?: string[] }} */
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--conductor-root') {
      result.conductorRoot = argv[++i];
    } else if (arg === '--tsup-cmd') {
      result.tsupCommand = JSON.parse(argv[++i]);
    }
  }
  return result;
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultConductorRoot = resolve(scriptDir, '..');
  const args = parseArgs(process.argv.slice(2));

  const { versionId, dir } = await publish({
    conductorRoot: args.conductorRoot ?? defaultConductorRoot,
    tsupCommand: args.tsupCommand,
  });

  process.stdout.write(`${JSON.stringify({ versionId, dir })}\n`);
}

if (isMain()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  });
}
