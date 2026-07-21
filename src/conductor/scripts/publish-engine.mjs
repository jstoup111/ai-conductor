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
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLISH_WRAPPER_ENV_VAR, assertPublishWrapperEnv } from './publish-guard.mjs';

const DEFAULT_TSUP_COMMAND = ['tsup'];

// Sentinel file written into `dist-versions/<id>/` immediately after a
// staging dir is renamed into place (finalized) and removed again once the
// `dist` symlink has actually been flipped to point at it. Its presence
// therefore marks "finalized but never flipped" — the signature left behind
// by a publish that was killed (SIGKILL, crash, power loss) in the narrow
// window between finalize and flip. There is no `catch` block that can run
// in that window (an in-process throw is caught below and would clean up
// normally; it's the un-catchable hard-kill case this sentinel exists for),
// so recovery instead happens lazily: the next `publish()` invocation scans
// for and removes any directory still carrying this sentinel before doing
// anything else. Best-effort/non-fatal — see `cleanupOrphanedStaging`.
const INCOMPLETE_SENTINEL = '.publish-incomplete';

// Sidecar file recording the source key (see `computeEngineSourceKey` in
// engine-store.ts) a version was built from. Written only after finalize +
// flip complete, in the same region that removes `INCOMPLETE_SENTINEL` —
// mirroring that sentinel's "present only on a fully-published version"
// precedent. Read by the pre-build skip check on the *next* publish to
// decide whether the tsup build can be skipped entirely. Plan ref:
// .docs/plans/engine-rebuild-content-cache.md, Design "Sidecar record".
const SOURCE_KEY_SIDECAR = '.engine-source-key';

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
 * Best-effort recovery from a previously-interrupted publish: scan
 * `storeRoot` for version directories still carrying `INCOMPLETE_SENTINEL`
 * (finalized but never flipped — see comment above) and remove them. Never
 * throws: a single directory's stat/rm failing is logged and skipped so one
 * bad entry can't block the rest of the cleanup, and cleanup as a whole
 * never fails the publish it's running ahead of.
 *
 * @param {{ storeRoot: string }} opts
 */
async function cleanupOrphanedStaging(opts) {
  let entries;
  try {
    entries = await readdir(opts.storeRoot, { withFileTypes: true });
  } catch {
    return; // No store root yet — nothing to clean up.
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const versionDir = join(opts.storeRoot, entry.name);
    try {
      await lstat(join(versionDir, INCOMPLETE_SENTINEL));
    } catch {
      continue; // No sentinel: a normal, fully-published version. Leave it.
    }

    try {
      await rm(versionDir, { recursive: true, force: true });
      console.error(
        `[publish-engine] cleaned up orphaned staging from an interrupted publish: ${versionDir}`,
      );
    } catch (err) {
      console.error(
        `[publish-engine] failed to clean up orphaned staging at ${versionDir} (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
 * @property {(o: { conductorRoot: string }) => Promise<string>} [computeSourceKey]
 *   - test seam overriding the real `computeEngineSourceKey` helper from
 *   engine-store.ts, parallel to `runCommand`/`tsupCommand`. Used both by the
 *   pre-build skip check and to stamp the `.engine-source-key` sidecar on a
 *   fresh publish.
 * @property {() => Promise<void>} [simulateCrashAfterFinalize] - test seam
 *   only. If provided, is awaited immediately after the staging dir has been
 *   finalized (renamed into `dist-versions/<id>/`, sentinel written) but
 *   before `flipCurrent` runs. Throwing from it models an un-catchable
 *   process kill in that exact window, leaving the finalized dir orphaned
 *   (sentinel still present, `dist` untouched) — see
 *   `test/engine/publish-interrupted.test.ts`.
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
  const {
    resolveEngineStoreRoot,
    computeVersionId,
    flipCurrent,
    gcVersions,
    currentTarget,
    computeEngineSourceKey,
  } = await loadEngineStore();
  const storeRoot = resolveEngineStoreRoot({ conductorRoot, env });
  const computeSourceKey = opts.computeSourceKey ?? computeEngineSourceKey;

  await migrateLegacyDistIfNeeded({
    conductorRoot,
    env,
    now: opts.now,
    resolveEngineStoreRoot,
    computeVersionId,
  });

  // Recover from any previous publish that was killed between finalize and
  // flip before doing anything else (Task 9, FR-13 neg).
  await cleanupOrphanedStaging({ storeRoot });

  // Pre-build source-cache skip (Design "Pre-build skip"): compare a hash of
  // the engine build *inputs* against the key recorded for the current
  // version, before ever invoking the (expensive) tsup build. Fail open on
  // any doubt — missing/corrupt sidecar, no current version, or a throwing
  // computeSourceKey all fall through to a normal build.
  let precomputedSourceKey;
  {
    const current = await currentTarget(conductorRoot);
    if (current) {
      const currentDir = join(storeRoot, current);
      let recordedKey;
      try {
        const raw = await readFile(join(currentDir, SOURCE_KEY_SIDECAR), 'utf-8');
        recordedKey = raw.trim();
      } catch {
        recordedKey = undefined;
      }

      if (recordedKey) {
        let computedKey;
        try {
          computedKey = await computeSourceKey({ conductorRoot });
        } catch (err) {
          console.error(
            `[publish-engine] source-key computation failed (fail open, building): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          computedKey = undefined;
        }

        if (computedKey && computedKey === recordedKey) {
          const intact = await lstat(currentDir).then(
            (s) => s.isDirectory(),
            () => false,
          );
          if (intact) {
            console.error(
              `[publish-engine] engine source unchanged (${computedKey}) — build skipped, dist stays at ${current}`,
            );
            return { versionId: current, dir: currentDir };
          }
        } else if (computedKey) {
          // Source changed; reuse the freshly-computed key below instead of
          // recomputing it for the sidecar write after this build finishes.
          precomputedSourceKey = computedKey;
        }
      }
    }
  }

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

    // Idempotence guard (#303): when the freshly-built content is identical to
    // what `dist` already points at, re-publishing would only mint a duplicate
    // snapshot and flip the symlink — dirtying the checkout (`M dist` +
    // untracked snapshot) on every `daemon start`/`bin/install` and freezing
    // the daemon's fast-forward tracking. Same content hash + intact current
    // snapshot → clean no-op.
    const contentHash = versionId.slice(versionId.lastIndexOf('-') + 1);
    const current = await currentTarget(conductorRoot);
    if (current && current.slice(current.lastIndexOf('-') + 1) === contentHash) {
      const currentDir = join(storeRoot, current);
      const intact = await lstat(currentDir).then(
        (s) => s.isDirectory(),
        () => false,
      );
      if (intact) {
        await rm(stagingDir, { recursive: true, force: true });
        console.error(
          `[publish-engine] content unchanged (${contentHash}) — publish skipped, dist stays at ${current}`,
        );
        return { versionId: current, dir: currentDir };
      }
      // Dangling/incomplete current target: fall through and publish to heal it.
    }

    await mkdir(storeRoot, { recursive: true });
    const finalDir = join(storeRoot, versionId);
    await rename(stagingDir, finalDir);
    await writeFile(join(finalDir, INCOMPLETE_SENTINEL), '', 'utf-8');

    if (opts.simulateCrashAfterFinalize) {
      await opts.simulateCrashAfterFinalize();
    }

    await flipCurrent({ conductorRoot, versionId, env });
    await rm(join(finalDir, INCOMPLETE_SENTINEL), { force: true });

    // Stamp the source-key sidecar (Design "Sidecar record") only once the
    // version is fully published (finalized + flipped) — same precedent as
    // the sentinel removal just above. Reuse the key computed by the
    // pre-build skip check above when available; otherwise (e.g. first-ever
    // publish, no prior current version) compute it fresh here. Best-effort:
    // a failure to compute/write the sidecar must never fail an otherwise
    // successful publish — it just means the next publish's skip check fails
    // open and rebuilds.
    try {
      const sourceKey = precomputedSourceKey ?? (await computeSourceKey({ conductorRoot }));
      await writeFile(join(finalDir, SOURCE_KEY_SIDECAR), sourceKey, 'utf-8');
    } catch (err) {
      console.error(
        `[publish-engine] failed to write ${SOURCE_KEY_SIDECAR} sidecar (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // GC old versions (Task 7, FR-15). Safety-critical + fail-closed by
    // design: `gcVersions` itself never deletes on an erroring read (registry
    // enumeration failure, an unreadable fleet pidfile) — it warns and
    // returns zero deletions instead. Belt-and-braces: any *unexpected*
    // throw out of `gcVersions` is also caught here so a GC hiccup never
    // turns a successful publish into a failed one (exit 0 either way).
    try {
      // Self-eviction guard (Task 3): when the calling daemon has stamped
      // its own running version into the env (Task 4), never let this GC
      // pass delete that version out from under it. `CONDUCT_ENGINE_SELF_GUARD`
      // is set unconditionally by a guarded daemon before it can resolve its
      // own version id, so an empty `CONDUCT_ENGINE_SELF_VERSION` alongside
      // it means "guard active but self version unresolved" — fail closed by
      // skipping the entire GC pass rather than risk deleting the running
      // dist. Guard unset entirely -> unguarded caller (e.g. a bare CLI
      // publish) -> GC runs exactly as before.
      const selfGuard = env.CONDUCT_ENGINE_SELF_GUARD;
      const selfVersion = env.CONDUCT_ENGINE_SELF_VERSION;
      if (selfGuard && !selfVersion) {
        console.error('[publish-engine] gc: skipped (self-guard, unresolved self version)');
      } else {
        const gcOpts = { conductorRoot, currentVersionId: versionId, env };
        if (selfGuard && selfVersion) {
          gcOpts.protectVersionIds = [selfVersion];
        }
        const { deletedCount } = await gcVersions(gcOpts);
        if (deletedCount > 0) {
          console.error(`[publish-engine] gc: deleted ${deletedCount} old version(s)`);
        }
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
