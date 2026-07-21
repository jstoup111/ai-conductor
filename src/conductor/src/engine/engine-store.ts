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
// The publish/flip machinery (staging build, atomic symlink flip) is built on
// top of these primitives in earlier tasks. This module additionally owns
// `gcVersions` (Task 7, FR-15): a safety-critical, fail-closed GC that only
// ever deletes a version directory when ALL FOUR of the following hold —
//   1. it is not the current (`dist`-linked) version,
//   2. it is not referenced by any live daemon pidfile across the fleet
//      (cross-checked against the project registry — see registry.ts),
//   3. it is at least `minAgeMsecs` old, and
//   4. it falls outside the newest `keepLastK` versions.
// Any error enumerating the registry, or reading ANY fleet pidfile (other
// than a plain "file absent"), aborts the entire GC pass with zero
// deletions — prefer never deleting over deleting on incomplete information.

import { readdir, lstat, readlink, readFile, symlink, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join, basename, dirname, relative } from 'node:path';
import { readRegistry, resolveRegistryPath, type ProjectRecord } from './registry.js';
import { getPidfilePath } from './daemon-lock.js';

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

export function isEngineVersionId(name: string): name is EngineVersionId {
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

export interface ComputeEngineSourceKeyOpts {
  /** The conductor package root (e.g. `src/conductor`). */
  conductorRoot: string;
}

/** Build-config inputs hashed alongside the `src/` tree, relative to `conductorRoot`. */
const ENGINE_SOURCE_KEY_CONFIG_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsup.config.ts',
  'scripts/publish-guard.mjs',
];

/**
 * Compute a sha256 over a defined, explicit superset of tsup's real build
 * inputs: the entire `src/` tree (recursively) plus the build-config files
 * listed in `ENGINE_SOURCE_KEY_CONFIG_FILES`, all resolved relative to
 * `conductorRoot`. Reuses the same sorted `path\0bytes\0` hashing convention
 * as `computeContentStamp` so the two stay consistent. Deterministic across
 * calls on identical content; changes whenever any file in the defined input
 * set changes; unaffected by files outside that set (over-inclusion is
 * deliberate — it can only cost an unnecessary rebuild, never a stale skip).
 */
export async function computeEngineSourceKey(opts: ComputeEngineSourceKeyOpts): Promise<string> {
  const { conductorRoot } = opts;
  const srcDir = join(conductorRoot, 'src');
  const srcFiles = (await collectFiles(srcDir, srcDir)).map((relPath) => join('src', relPath));
  const relPaths = [...srcFiles, ...ENGINE_SOURCE_KEY_CONFIG_FILES];
  relPaths.sort();

  const hash = createHash('sha256');
  for (const relPath of relPaths) {
    const contents = await readFile(join(conductorRoot, relPath));
    hash.update(relPath);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return hash.digest('hex');
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

export interface FlipCurrentOpts {
  /** The conductor package root (e.g. `src/conductor`). */
  conductorRoot: string;
  /** The already-published version id to flip `dist` to point at. */
  versionId: EngineVersionId;
  /** Env to resolve the store root from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Atomically flip the `dist` symlink to point at `dist-versions/<versionId>`.
 *
 * Never done in-place: a fresh symlink is created at a private tmp path
 * (`.dist-tmp-<random>` alongside `dist`) pointing at the target version
 * dir, then `rename()`d on top of `dist`. `rename` on the same filesystem is
 * atomic — there is no window in which `dist` is absent or points at a
 * half-written target: it's either the old symlink or the new one.
 *
 * The published version directory itself is never touched (no writes, no
 * mtime changes) — only the `dist` symlink (and a transient tmp symlink) are
 * created/renamed.
 *
 * Throws if `dist-versions/<versionId>` does not exist (refuses to flip to a
 * version that hasn't been published).
 *
 * @returns the same `versionId`, once the flip has completed.
 */
export async function flipCurrent(opts: FlipCurrentOpts): Promise<EngineVersionId> {
  const env = opts.env ?? process.env;
  const storeRoot = resolveEngineStoreRoot({ conductorRoot: opts.conductorRoot, env });
  const versionDir = join(storeRoot, opts.versionId);

  // Fail fast if the target version hasn't actually been published.
  const versionStat = await lstat(versionDir);
  if (!versionStat.isDirectory()) {
    throw new Error(`flipCurrent: ${versionDir} is not a directory`);
  }

  const distPath = join(opts.conductorRoot, DIST_SYMLINK);
  const tmpPath = join(opts.conductorRoot, `.dist-tmp-${randomBytes(6).toString('hex')}`);

  // The symlink target must be RELATIVE: `dist` may be committed to git, and
  // an absolute target dangles in every other clone/checkout (and breaks the
  // moment a worktree is moved or removed). Relative also survives the store
  // living outside conductorRoot via env override (`../…` path).
  const linkTarget = relative(dirname(distPath), versionDir);
  await symlink(linkTarget, tmpPath);
  try {
    await rename(tmpPath, distPath);
  } catch (err) {
    // Best-effort cleanup of the tmp symlink if the rename itself failed.
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  return opts.versionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// gcVersions — safety-critical, fail-closed version GC (Task 7, FR-15).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MIN_AGE_MSECS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_KEEP_LAST_K = 3;

export interface GcVersionsOpts {
  /** The conductor package root (e.g. `src/conductor`). */
  conductorRoot: string;
  /** The currently-flipped version id — never a deletion candidate. */
  currentVersionId: EngineVersionId;
  /** Minimum age (ms) a version must have before it's GC-eligible. Default: 24h. */
  minAgeMsecs?: number;
  /** Number of newest versions (by id, which sorts chronologically) always kept. Default: 3. */
  keepLastK?: number;
  /** Override the project registry path (test seam). Defaults to `resolveRegistryPath()`. */
  registryPath?: string;
  /** Env to resolve the store root / registry path from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Injectable clock for age comparisons (tests). Defaults to `new Date()`. */
  now?: Date;
  /** Warning sink (tests capture; default: console.warn). One line per warning. */
  warn?: (message: string) => void;
  /**
   * Version ids to never delete this pass, regardless of the four legacy
   * conditions — e.g. the version the CALLING daemon's own dist is running
   * out of, so a GC pass can never self-evict the process invoking it.
   */
  protectVersionIds?: EngineVersionId[];
}

export interface GcVersionsResult {
  /** Version ids actually deleted this pass (possibly empty). */
  deleted: EngineVersionId[];
  /** `deleted.length` — convenience for callers that only want the count. */
  deletedCount: number;
}

const NO_DELETIONS: Omit<GcVersionsResult, 'deleted'> & { deleted: EngineVersionId[] } = {
  deleted: [],
  deletedCount: 0,
};

/**
 * Extract the `EngineVersionId` path segment embedded in a pidfile's
 * `engineDir` (e.g. `.../dist-versions/<id>/engine`), or `undefined` if none
 * of the path segments match the version-id format (e.g. a dev/unpublished
 * `src/engine` run, which references no published version and therefore
 * blocks nothing).
 */
export function versionIdFromEngineDir(engineDir: string): EngineVersionId | undefined {
  const segments = engineDir.split(/[\\/]/);
  const match = segments.find((segment) => isEngineVersionId(segment));
  return match as EngineVersionId | undefined;
}

/**
 * Read the fleet-wide set of version ids currently referenced by a LIVE
 * daemon pidfile, cross-checking every repo in the project registry.
 *
 * Fail-closed contract: this NEVER silently ignores an error.
 *   - Registry enumeration failure (corrupt/unreadable registry.json) ->
 *     throws; caller aborts the whole GC pass with zero deletions.
 *   - A pidfile that's absent (ENOENT) for a given repo -> that repo simply
 *     references nothing; not an error.
 *   - A pidfile that exists but can't be read/parsed (permission denied,
 *     corrupt JSON) -> throws; caller aborts the whole GC pass with zero
 *     deletions. We cannot prove that version is unreferenced, so it (and
 *     every other candidate) is protected this pass.
 */
async function readLiveReferencedVersionIds(
  registryPath: string,
): Promise<Set<EngineVersionId>> {
  const records: ProjectRecord[] = await readRegistry(registryPath);

  const referenced = new Set<EngineVersionId>();
  for (const record of records) {
    const pidfilePath = getPidfilePath(record.path);

    let raw: string;
    try {
      raw = await readFile(pidfilePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue; // no pidfile: fine
      throw new Error(
        `gcVersions: cannot read pidfile at ${pidfilePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `gcVersions: pidfile at ${pidfilePath} is corrupt (invalid JSON): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const engineDir = (parsed as { engineDir?: unknown })?.engineDir;
    if (typeof engineDir !== 'string') continue; // older pidfile shape: references nothing knowable

    const versionId = versionIdFromEngineDir(engineDir);
    if (versionId) referenced.add(versionId);
  }

  return referenced;
}

/**
 * GC old published versions under `dist-versions/`, per the four-condition
 * fail-closed policy documented at the top of this section (FR-15). Deletes
 * oldest-eligible-first; a single version's delete failing is logged and
 * does NOT stop the remaining eligible versions from being attempted
 * (best-effort on the delete step itself — the fail-closed guarantee is
 * about never deleting on incomplete/erroring READS, not about one delete's
 * failure blocking siblings).
 */
export async function gcVersions(opts: GcVersionsOpts): Promise<GcVersionsResult> {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const minAgeMsecs = opts.minAgeMsecs ?? DEFAULT_MIN_AGE_MSECS;
  const keepLastK = opts.keepLastK ?? DEFAULT_KEEP_LAST_K;
  const now = opts.now ?? new Date();

  const storeRoot = resolveEngineStoreRoot({ conductorRoot: opts.conductorRoot, env });
  const registryPath = opts.registryPath ?? resolveRegistryPath({ env });

  let liveReferenced: Set<EngineVersionId>;
  try {
    liveReferenced = await readLiveReferencedVersionIds(registryPath);
  } catch (err) {
    warn(
      `[gcVersions] aborting GC pass, zero deletions: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ...NO_DELETIONS };
  }

  const versions = await listVersions(storeRoot); // ascending: oldest first (id begins with timestamp)
  const protectedByKeepK = new Set(versions.slice(Math.max(0, versions.length - keepLastK)));
  const protectedSelf = new Set(opts.protectVersionIds ?? []);

  const deleted: EngineVersionId[] = [];
  for (const versionId of versions) {
    if (protectedSelf.has(versionId)) continue; // self-eviction guard: never delete an explicitly protected version
    if (versionId === opts.currentVersionId) continue; // condition 1: never delete current
    if (liveReferenced.has(versionId)) continue; // condition 2: never delete live-referenced
    if (protectedByKeepK.has(versionId)) continue; // condition 4: keep newest K regardless of age

    const versionDir = join(storeRoot, versionId);
    let versionStat;
    try {
      versionStat = await lstat(versionDir);
    } catch {
      continue; // vanished already (e.g. deleted out-of-band) — nothing to do
    }
    const ageMs = now.getTime() - versionStat.mtimeMs;
    if (ageMs < minAgeMsecs) continue; // condition 3: too young

    try {
      await rm(versionDir, { recursive: true, force: true });
      deleted.push(versionId);
    } catch (err) {
      warn(
        `[gcVersions] failed to delete ${versionDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { deleted, deletedCount: deleted.length };
}
