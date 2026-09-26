import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { AUDIT_TRAIL_DIRECTORY } from './audit-trail.js';
import { BUILD_REVIEW_POLICY_MATERIAL_DIRECTORY } from './build-review-artifacts.js';
import { BUILD_REVIEW_CACHE_DIRECTORY } from './build-review-cache.js';
import { FEATURE_EVENT_LOG_PATH } from './event-persister.js';
import { STEP_HEARTBEAT_PATH } from './step-heartbeat.js';

const PIPELINE_DIRECTORY = '.pipeline/';

function pipelineRelative(path: string): string {
  if (!path.startsWith(PIPELINE_DIRECTORY)) throw new Error(`engine-owned lap write is outside the pipeline: ${path}`);
  return path.slice(PIPELINE_DIRECTORY.length);
}

/**
 * Pipeline paths the engine itself appends to or rewrites while a lap runs
 * (event ledgers, heartbeat, verdict cache, captured policy copies). They are
 * relative to the pipeline evidence root and derived from their writers' own
 * path constants, so a lap never invalidates itself through its telemetry.
 * Captured policy bytes are protected by their own digest root instead.
 */
export const BUILD_REVIEW_ENGINE_OWNED_LAP_WRITES: readonly string[] = Object.freeze([
  FEATURE_EVENT_LOG_PATH,
  AUDIT_TRAIL_DIRECTORY,
  STEP_HEARTBEAT_PATH,
  BUILD_REVIEW_CACHE_DIRECTORY,
  BUILD_REVIEW_POLICY_MATERIAL_DIRECTORY,
].map(pipelineRelative));

export const BUILD_REVIEW_INPUT_ROOT_KINDS = [
  'frozenHead',
  'frozenBaseline',
  'capturedPolicyMaterial',
  'installedPolicyPackage',
  'evidenceRoot',
] as const;

export type BuildReviewInputRootKind = typeof BUILD_REVIEW_INPUT_ROOT_KINDS[number];

export interface BuildReviewInputDigestRoots {
  readonly frozenHead: string;
  readonly frozenBaseline: string;
  readonly capturedPolicyMaterial: string | readonly string[];
  readonly installedPolicyPackage: string | readonly string[];
  readonly evidenceRoot: string;
  /** Engine outputs written while the lap settles are never review inputs. */
  readonly evidenceRootExcludes?: readonly string[];
}

export interface BuildReviewInputIntegrityFilesystem {
  readdir(path: string): Promise<readonly string[]>;
  lstat(path: string): Promise<{ readonly kind: 'file' | 'directory' | 'other' }>;
  readFile(path: string): Promise<Buffer>;
}

export interface BuildReviewInputDigestEntry {
  readonly root: BuildReviewInputRootKind;
  readonly relativePath: string;
  readonly contentHash: string;
}

export interface BuildReviewInputDigest {
  readonly version: 1;
  readonly entries: readonly BuildReviewInputDigestEntry[];
}

const filesystem: BuildReviewInputIntegrityFilesystem = {
  readdir,
  lstat: async (path) => {
    const entry = await lstat(path);
    return {
      kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
    };
  },
  readFile,
};

function contentHash(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function isNotFound(error: unknown): boolean {
  return (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
    || error instanceof Error && error.message.includes('ENOENT');
}

async function collectRegularFiles(
  current: string,
  reader: BuildReviewInputIntegrityFilesystem,
): Promise<readonly string[]> {
  let entry: { readonly kind: 'file' | 'directory' | 'other' };
  try {
    entry = await reader.lstat(current);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  if (entry.kind === 'file') return [current];
  if (entry.kind !== 'directory') return [];

  const paths: string[] = [];
  for (const name of [...await reader.readdir(current)].sort()) {
    paths.push(...await collectRegularFiles(join(current, name), reader));
  }
  return paths;
}

/**
 * Captures only the frozen lap inputs. The feature checkout is intentionally
 * absent: branch artifacts may be written while reviewers are running.
 */
export async function captureBuildReviewInputDigest(
  roots: BuildReviewInputDigestRoots,
  reader: BuildReviewInputIntegrityFilesystem = filesystem,
): Promise<BuildReviewInputDigest> {
  const entries: BuildReviewInputDigestEntry[] = [];
  for (const root of BUILD_REVIEW_INPUT_ROOT_KINDS) {
    const rootPaths = Array.isArray(roots[root]) ? roots[root] : [roots[root]];
    for (const rootPath of rootPaths) for (const path of await collectRegularFiles(rootPath, reader)) {
      const relativePath = relative(rootPath, path).split('\\').join('/');
      if (root === 'evidenceRoot' && roots.evidenceRootExcludes?.some(
        (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
      )) continue;
      entries.push({
        root,
        relativePath,
        contentHash: contentHash(await reader.readFile(path)),
      });
    }
  }
  entries.sort((left, right) => (
    left.root.localeCompare(right.root) || left.relativePath.localeCompare(right.relativePath)
  ));
  return { version: 1, entries };
}

function entryKey(entry: BuildReviewInputDigestEntry): string {
  return `${entry.root}\u0000${entry.relativePath}`;
}

function displayPath(entry: BuildReviewInputDigestEntry): string {
  return `${entry.root}:${entry.relativePath}`;
}

/**
 * Lists mutations to lap inputs. Evidence created after fan-out is excluded;
 * only evidence that existed at capture time can invalidate a lap.
 */
export async function diffBuildReviewInputDigests(
  before: BuildReviewInputDigest,
  after: BuildReviewInputDigest,
): Promise<readonly string[]> {
  const beforeEntries = new Map(before.entries.map((entry) => [entryKey(entry), entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entryKey(entry), entry]));
  const changed = new Set<string>();

  for (const [key, entry] of beforeEntries) {
    const current = afterEntries.get(key);
    if (current === undefined || current.contentHash !== entry.contentHash) {
      changed.add(displayPath(entry));
    }
  }
  for (const [key, entry] of afterEntries) {
    if (entry.root !== 'evidenceRoot' && !beforeEntries.has(key)) {
      changed.add(displayPath(entry));
    }
  }
  return [...changed].sort();
}
