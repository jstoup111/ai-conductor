// Versioned engine store — layout primitives (ADR: versioned-engine-store,
// atomic-flip; Phase 1, FR-13/FR-14).
//
// Layout:
//   <conductorRoot>/dist-versions/<version-id>/   — one immutable build per id
//   <conductorRoot>/dist                          — symlink to the current
//                                                    `dist-versions/<id>` dir
//
// This module owns:
//   - resolveEngineStoreRoot: where the store root lives (env-overridable for
//     tests — AI_CONDUCTOR_ENGINE_STORE — else `<conductorRoot>/dist-versions`).
//   - computeVersionId: a stable, typed id (`EngineVersionId`) combining a
//     build timestamp with a content-addressed stamp so two builds of a dirty
//     (uncommitted) tree never collide.
//   - listVersions: enumerate version directories under a store root.
//   - currentTarget: resolve the `dist` symlink to the version id it points at
//     (never throws on a dangling/missing symlink — callers treat that as
//     "no current version" rather than a hard failure).
//
// The publish/flip/GC machinery (staging build, atomic symlink flip, garbage
// collection) is built on top of these primitives in later tasks — this
// module intentionally has no knowledge of tsup, staging dirs, or the
// registry.

import { readdir, lstat, readlink, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

/**
 * A branded string type for version ids so callers can't accidentally pass a
 * bare/arbitrary string where a real version id (produced by
 * `computeVersionId` or read back via `listVersions`/`currentTarget`) is
 * required.
 */
export type EngineVersionId = string & { readonly __brand: 'EngineVersionId' };

const ENGINE_STORE_ENV_VAR = 'AI_CONDUCTOR_ENGINE_STORE';
const DIST_VERSIONS_DIR = 'dist-versions';
const DIST_SYMLINK = 'dist';

/** Format: `<YYYYMMDDTHHMMSSZ>-<12 hex chars of content hash>`. */
const VERSION_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;

function isEngineVersionId(name: string): name is EngineVersionId {
  return VERSION_ID_PATTERN.test(name);
}

export interface ResolveEngineStoreRootOpts {
  /** The conductor package root (e.g. `src/conductor`). */
  conductorRoot: string;
  /** Env to read the override from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the engine store root directory: `$AI_CONDUCTOR_ENGINE_STORE` wins
 * if set (test seam / operator override), else `<conductorRoot>/dist-versions`.
 */
export function resolveEngineStoreRoot(opts: ResolveEngineStoreRootOpts): string {
  const env = opts.env ?? process.env;
  const override = env[ENGINE_STORE_ENV_VAR];
  if (override) return override;
  return join(opts.conductorRoot, DIST_VERSIONS_DIR);
}

/** Zero-padded numeric fields; no separators, per `VERSION_ID_PATTERN`. */
function formatTimestamp(now: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

export interface ComputeVersionIdOpts {
  /** Directory whose contents are hashed to produce the content stamp. */
  srcDir: string;
  /** Build timestamp. Defaults to `new Date()`. Injectable for tests. */
  now?: Date;
}

/**
 * Compute a stable `EngineVersionId` for a build of `srcDir`: the build
 * timestamp plus a content-addressed stamp (sha256 of every file's relative
 * path + bytes, recursively, in deterministic sorted order). Two builds of a
 * dirty (uncommitted) tree with different content therefore always produce
 * different ids even when built in the same second; two builds of identical
 * content produce the same stamp (deterministic).
 */
export async function computeVersionId(opts: ComputeVersionIdOpts): Promise<EngineVersionId> {
  const now = opts.now ?? new Date();
  const stamp = await computeContentStamp(opts.srcDir);
  return `${formatTimestamp(now)}-${stamp}` as EngineVersionId;
}

async function computeContentStamp(srcDir: string): Promise<string> {
  const files = await collectFiles(srcDir, srcDir);
  files.sort();
  const hash = createHash('sha256');
  for (const relPath of files) {
    const contents = await readFile(join(srcDir, relPath));
    hash.update(relPath);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

async function collectFiles(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(root, abs)));
    } else if (entry.isFile()) {
      results.push(abs.slice(root.length + 1));
    }
  }
  return results;
}

/**
 * List all version ids present under `storeRoot`, sorted ascending (which is
 * also chronological, since the id begins with the build timestamp). Returns
 * `[]` if the store root does not exist. Non-directory entries and entries
 * whose name doesn't match the version-id format are ignored (defensive
 * against stray files under the store root).
 */
export async function listVersions(storeRoot: string): Promise<EngineVersionId[]> {
  let entries;
  try {
    entries = await readdir(storeRoot, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }

  const versions = entries
    .filter((entry) => entry.isDirectory() && isEngineVersionId(entry.name))
    .map((entry) => entry.name as EngineVersionId);

  versions.sort();
  return versions;
}

/**
 * Resolve the `dist` symlink under `conductorRoot` to the `EngineVersionId`
 * it currently targets. Returns `undefined` (never throws) when the symlink
 * is absent, is not a symlink, or is dangling (target no longer exists) —
 * callers treat all of these as "no current version".
 */
export async function currentTarget(conductorRoot: string): Promise<EngineVersionId | undefined> {
  const distPath = join(conductorRoot, DIST_SYMLINK);

  let stat;
  try {
    stat = await lstat(distPath);
  } catch {
    return undefined;
  }
  if (!stat.isSymbolicLink()) return undefined;

  let target: string;
  try {
    target = await readlink(distPath);
  } catch {
    return undefined;
  }

  const versionId = basename(target);
  if (!isEngineVersionId(versionId)) return undefined;
  return versionId;
}
