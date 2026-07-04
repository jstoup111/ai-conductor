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
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_TSUP_COMMAND = ['tsup'];

// This script runs as a plain Node process BEFORE the engine has ever been
// built (chicken-and-egg: it IS the build), so it can't `import` the
// TypeScript source of `engine-store.ts` the normal way — there is no
// compiled `dist/` yet for a first publish, and the Node version this repo
// targets (>=20.5) has no built-in TS support. Rather than duplicate
// `resolveEngineStoreRoot`/`computeVersionId` as a second implementation
// that could drift from the real one, this loads the single source of
// truth directly: transpile `src/engine/engine-store.ts` with esbuild (an
// existing transitive dependency of `tsup`, already vendored in
// node_modules) and import the result. No bundling, no type-checking — just
// strip types from this one self-contained module (it only imports Node
// builtins).
async function loadEngineStore() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(scriptDir, '..', 'src', 'engine', 'engine-store.ts');
  const source = await readFile(sourcePath, 'utf-8');

  const esbuild = await import('esbuild');
  const { code } = await esbuild.transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'node20',
    sourcefile: 'engine-store.ts',
  });

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
  const { resolveEngineStoreRoot, computeVersionId, flipCurrent } = await loadEngineStore();
  const storeRoot = resolveEngineStoreRoot({ conductorRoot, env });

  const stagingParent = conductorRoot;
  const stagingDir = await mkdtemp(join(stagingParent, '.engine-staging-'));

  const runCommand =
    opts.runCommand ??
    (async (cmd, execOpts) => {
      const [bin, ...args] = cmd;
      await execa(bin, args, { cwd: execOpts.cwd, stdio: 'inherit' });
    });

  try {
    const tsupCommand = resolveTsupCommand({ tsupCommand: opts.tsupCommand, env });
    await runCommand([...tsupCommand, '--out-dir', stagingDir], { cwd: conductorRoot });

    const versionId = await computeVersionId({ srcDir: stagingDir, now: opts.now });
    await mkdir(storeRoot, { recursive: true });
    const finalDir = join(storeRoot, versionId);
    await rename(stagingDir, finalDir);

    await flipCurrent({ conductorRoot, versionId, env });

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
