import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
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
  const configuredParent = env[VITEST_TMP_BASE_ENV];
  if (configuredParent === undefined) return join(packageDir, '.vitest-tmp');
  if (
    configuredParent.trim() === ''
    || configuredParent.includes('\0')
    || !isAbsolute(configuredParent)
  ) {
    throw new Error(
      `Invalid ${VITEST_TMP_BASE_ENV} path ${JSON.stringify(configuredParent)}: expected a non-empty absolute path without NUL bytes`,
    );
  }
  return configuredParent;
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

function allocationError(location, cause) {
  return new Error(
    `Unable to allocate Vitest temporary storage at ${location}: ${cause.message}`,
    { cause },
  );
}

function allocate(fs, location, operation) {
  try {
    return operation();
  } catch (cause) {
    throw allocationError(location, cause);
  }
}

function canonicalizeCreatedRoot(fs, createdRoot) {
  try {
    return canonicalize(fs, createdRoot);
  } catch (cause) {
    try {
      fs.rmSync(createdRoot, { recursive: true, force: true });
    } catch {
      // The allocation failure is more useful than a best-effort cleanup error.
    }
    throw allocationError(createdRoot, cause);
  }
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
 * @param {{ env?: NodeJS.ProcessEnv, packageDir?: string, fs?: Pick<typeof import('node:fs'), 'mkdirSync'|'mkdtempSync'|'realpathSync'|'rmSync'> }} options
 */
export function allocateVitestTmpScope({
  env = process.env,
  packageDir = packageLocalDir,
  fs = { mkdirSync, mkdtempSync, realpathSync, rmSync },
} = {}) {
  const parent = selectVitestTmpParent({ env, packageDir });
  allocate(fs, parent, () => fs.mkdirSync(parent, { recursive: true }));
  const canonicalParent = allocate(fs, parent, () => canonicalize(fs, parent));
  const rootPrefix = join(canonicalParent, VITEST_RUN_ROOT_PREFIX);
  const createdRoot = allocate(fs, rootPrefix, () => fs.mkdtempSync(rootPrefix));
  const root = canonicalizeCreatedRoot(fs, createdRoot);

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
      const rootPrefix = join(current, VITEST_RUN_ROOT_PREFIX);
      const createdRoot = allocate(fs, rootPrefix, () => fs.mkdtempSync(rootPrefix));
      return { parent: current, root: canonicalizeCreatedRoot(fs, createdRoot), scope, ownsRoot: true, ownsScope: false };
    }
  }
  return allocateVitestTmpScope({ env, packageDir, fs });
}

/**
 * Install a run root exactly once. Re-imported config modules reuse an
 * installed root; launchers may pass `fresh: true` to get an owned scope.
 * Environment mutation is deliberately deferred until allocation succeeds.
 *
 * @param {{ env?: NodeJS.ProcessEnv, packageDir?: string, fs?: Pick<typeof import('node:fs'), 'mkdirSync'|'mkdtempSync'|'realpathSync'|'rmSync'>, fresh?: boolean }} options
 */
export function installVitestTmpRoot({
  env = process.env,
  packageDir = packageLocalDir,
  fs = { mkdirSync, mkdtempSync, realpathSync, rmSync },
  fresh = false,
} = {}) {
  const environment = snapshotVitestTmpEnvironment(env);
  const existingRoot = !fresh && env[VITEST_TMP_ROOT_ENV];
  selectVitestTmpParent({ env, packageDir });
  if (existingRoot && env[VITEST_ORIGINAL_TMPDIR_ENV] === undefined) {
    throw new Error(
      `Cannot reuse ${VITEST_TMP_ROOT_ENV} without ${VITEST_ORIGINAL_TMPDIR_ENV}`,
    );
  }
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
