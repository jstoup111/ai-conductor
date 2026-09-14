import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VITEST_TMP_BASE_ENV = 'AI_CONDUCTOR_TEST_TMP_BASE';
export const VITEST_TMP_ROOT_ENV = 'AI_CONDUCTOR_TEST_TMP_ROOT';
export const VITEST_TMP_SCOPE_ENV = 'AI_CONDUCTOR_TEST_TMP_SCOPE';
export const VITEST_ORIGINAL_TMPDIR_ENV = 'AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR';
export const VITEST_RUN_ROOT_PREFIX = 'ai-conductor-vitest-run-';

const packageLocalDir = dirname(dirname(fileURLToPath(import.meta.url)));
const contextKeys = [
  VITEST_TMP_ROOT_ENV,
  VITEST_TMP_SCOPE_ENV,
  VITEST_ORIGINAL_TMPDIR_ENV,
  'TMPDIR',
  'GIT_CEILING_DIRECTORIES',
];

/**
 * Select the parent which owns Vitest's disposable storage.  This deliberately
 * does not consult `os.tmpdir()`: doing so after a redirect is installed would
 * make the next run inherit the preceding run's disposable directory.
 *
 * @param {{ env?: NodeJS.ProcessEnv, packageDir?: string }} options
 */
export function selectVitestTmpParent({
  env = process.env,
  packageDir = packageLocalDir,
} = {}) {
  return env[VITEST_TMP_BASE_ENV] ?? join(packageDir, '.vitest-tmp');
}

/** Capture precisely the environment entries this module can mutate. */
export function snapshotVitestTmpEnvironment(env = process.env) {
  return Object.fromEntries(contextKeys.map(key => [key, env[key]]));
}

/** Restore a snapshot produced by {@link snapshotVitestTmpEnvironment}. */
export function restoreVitestTmpEnvironment(snapshot, env = process.env) {
  for (const key of contextKeys) {
    if (snapshot[key] === undefined) delete env[key];
    else env[key] = snapshot[key];
  }
}

function canonicalize(fs, path) {
  return fs.realpathSync(path);
}

function isWithin(path, parent) {
  const remainder = relative(parent, path);
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder));
}

function appendGitCeiling(env, root) {
  const existing = env.GIT_CEILING_DIRECTORIES;
  if (!existing) {
    env.GIT_CEILING_DIRECTORIES = root;
  } else if (!existing.split(delimiter).includes(root)) {
    env.GIT_CEILING_DIRECTORIES = `${existing}${delimiter}${root}`;
  }
}

/**
 * Allocate one fresh, caller-owned run scope.  The scope is the run root so a
 * nested invocation can retain it after clearing only its installed root.
 *
 * @param {{ env?: NodeJS.ProcessEnv, packageDir?: string, fs?: Pick<typeof import('node:fs'), 'mkdirSync'|'mkdtempSync'|'realpathSync'> }} options
 */
export function allocateVitestTmpScope({
  env = process.env,
  packageDir = packageLocalDir,
  fs = { mkdirSync, mkdtempSync, realpathSync },
} = {}) {
  const parent = selectVitestTmpParent({ env, packageDir });
  fs.mkdirSync(parent, { recursive: true });
  const canonicalParent = canonicalize(fs, parent);
  const createdRoot = fs.mkdtempSync(join(canonicalParent, VITEST_RUN_ROOT_PREFIX));
  const root = canonicalize(fs, createdRoot);

  return {
    parent: canonicalParent,
    root,
    scope: root,
    ownsRoot: true,
    ownsScope: true,
  };
}

function allocateNestedRoot({ env, packageDir, fs }) {
  const declaredScope = env[VITEST_TMP_SCOPE_ENV];
  const currentTmpdir = env.TMPDIR;
  if (declaredScope && currentTmpdir) {
    const scope = canonicalize(fs, declaredScope);
    const current = canonicalize(fs, currentTmpdir);
    if (isWithin(current, scope)) {
      const createdRoot = fs.mkdtempSync(join(current, VITEST_RUN_ROOT_PREFIX));
      return { parent: current, root: canonicalize(fs, createdRoot), scope, ownsRoot: true, ownsScope: false };
    }
  }
  return allocateVitestTmpScope({ env, packageDir, fs });
}

/**
 * Install a run root exactly once. Re-imported config modules reuse an
 * installed root; launchers may pass `fresh: true` to get an owned scope.
 * Environment mutation is deliberately deferred until allocation succeeds.
 *
 * @param {{ env?: NodeJS.ProcessEnv, packageDir?: string, fs?: Pick<typeof import('node:fs'), 'mkdirSync'|'mkdtempSync'|'realpathSync'>, fresh?: boolean }} options
 */
export function installVitestTmpRoot({
  env = process.env,
  packageDir = packageLocalDir,
  fs = { mkdirSync, mkdtempSync, realpathSync },
  fresh = false,
} = {}) {
  const environment = snapshotVitestTmpEnvironment(env);
  const existingRoot = !fresh && env[VITEST_TMP_ROOT_ENV];
  const allocation = existingRoot
    ? {
      root: canonicalize(fs, existingRoot),
      scope: env[VITEST_TMP_SCOPE_ENV] ? canonicalize(fs, env[VITEST_TMP_SCOPE_ENV]) : canonicalize(fs, existingRoot),
      ownsRoot: false,
      ownsScope: false,
    }
    : allocateNestedRoot({ env, packageDir, fs });

  const originalTmpdir = env[VITEST_ORIGINAL_TMPDIR_ENV] ?? env.TMPDIR;
  env[VITEST_TMP_ROOT_ENV] = allocation.root;
  env[VITEST_TMP_SCOPE_ENV] = allocation.scope;
  if (originalTmpdir !== undefined) env[VITEST_ORIGINAL_TMPDIR_ENV] = originalTmpdir;
  env.TMPDIR = allocation.root;
  appendGitCeiling(env, allocation.root);

  return {
    ...allocation,
    originalTmpdir,
    environment,
  };
}
