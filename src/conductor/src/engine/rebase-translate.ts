import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitRunner } from './rebase.js';

// Task 3 of .docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md
//
// Pure old-sha -> new-sha correspondence builder + persistence, per
// adr-2026-07-12-rebase-evidence-stamp-translation.md. Matches pre-image
// (ORIG_HEAD-reachable) commits to post-image (HEAD-reachable) commits by
// `git patch-id --stable` diff correspondence. All git interaction goes
// through the injected GitRunner — no direct child_process calls here.

/** Result of `buildRewriteMap`: old-sha -> new-sha correspondence, plus residue. */
export interface RewriteMapResult {
  /** old sha (full AND 7-char short) -> new full sha. */
  map: Record<string, string>;
  /** Full pre-image shas with no patch-id match post-rebase. */
  residue: string[];
}

const SHORT_SHA_LEN = 7;

/** GitRunner extended with the optional `input` stdin param used by `git patch-id`. */
type GitRunnerWithInput = (
  args: string[],
  opts?: { input?: string },
) => Promise<{ stdout: string }>;

function parseShaList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function patchIdFor(git: GitRunnerWithInput, sha: string): Promise<string> {
  const showResult = await git(['show', sha]);
  const diffText = showResult.stdout;

  const patchIdResult = await git(['patch-id', '--stable'], { input: diffText });

  const [id] = patchIdResult.stdout.trim().split(/\s+/);
  return id ?? '';
}

/**
 * Builds the old-sha -> new-sha correspondence for a rebase, matching
 * pre-image commits (`{onto}..{origHead}`) to post-image commits
 * (`{onto}..{head}`) by `git patch-id --stable`.
 *
 * Returns a map indexed by both the full 40-char pre-image sha and its
 * 7-char short form, both pointing at the same post-image full sha, plus a
 * residue list of pre-image shas with no patch-id match.
 */
export async function buildRewriteMap(
  git: GitRunner,
  onto: string,
  origHead: string,
  head: string,
): Promise<RewriteMapResult> {
  const gitAny = git as unknown as GitRunnerWithInput;

  const [preResult, postResult] = await Promise.all([
    gitAny(['rev-list', `${onto}..${origHead}`]),
    gitAny(['rev-list', `${onto}..${head}`]),
  ]);

  const preShas = parseShaList(preResult.stdout);
  const postShas = parseShaList(postResult.stdout);

  // Build post-image patch-id -> post sha index.
  const postByPatchId = new Map<string, string>();
  for (const postSha of postShas) {
    const id = await patchIdFor(gitAny, postSha);
    if (id) {
      postByPatchId.set(id, postSha);
    }
  }

  const map: Record<string, string> = {};
  const residue: string[] = [];

  for (const preSha of preShas) {
    const id = await patchIdFor(gitAny, preSha);
    const postSha = id ? postByPatchId.get(id) : undefined;

    if (postSha) {
      map[preSha] = postSha;
      map[preSha.slice(0, SHORT_SHA_LEN)] = postSha;
    } else {
      residue.push(preSha);
    }
  }

  return { map, residue };
}

/**
 * Resolves `sha` through `map` transitively (follows chained rewrites to the
 * final value). Returns the input unchanged if it is not a key in the map —
 * this is the structural gate that prevents laundering an unrelated/forged
 * sha (it can never become a map key, so it can never resolve to anything
 * else).
 */
export function resolveThroughMap(sha: string, map: Record<string, string>): string {
  const seen = new Set<string>();
  let current = sha;

  while (Object.prototype.hasOwnProperty.call(map, current) && !seen.has(current)) {
    seen.add(current);
    current = map[current];
  }

  return current;
}

interface SerializedRewriteMap {
  map: Record<string, string>;
}

interface EvidenceStampLike {
  sha?: string;
  citedShas?: string[];
  verdictAnchor?: string;
  [key: string]: unknown;
}

interface SerializedEvidenceDataLike {
  evidenceStamps: Record<string, EvidenceStampLike>;
  [key: string]: unknown;
}

interface TaskStatusTaskLike {
  id: string;
  commit?: string;
  [key: string]: unknown;
}

interface TaskStatusFileLike {
  tasks: TaskStatusTaskLike[];
  [key: string]: unknown;
}

async function atomicWriteJson(
  dir: string,
  filePath: string,
  prefix: string,
  data: unknown,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tempFile = join(
    dir,
    `.${prefix}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await writeFile(tempFile, JSON.stringify(data, null, 2));
    await rename(tempFile, filePath);
  } catch (err) {
    await rm(tempFile, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Rewrites every mapped sha occurrence in `.pipeline/task-evidence.json`
 * (EvidenceStamp `sha`, `citedShas[]`, `verdictAnchor`) and
 * `.pipeline/task-status.json` (TaskStatusRecord `commit`, both full and
 * short-sha forms) through `map`, in place. Shas that are not keys in `map`
 * are left byte-identical. Missing files are silently skipped (no-op).
 *
 * Reuses the atomic temp+rename discipline from `task-evidence.ts`'s
 * `write()`.
 */
export async function applyMapToStores(
  projectRoot: string,
  map: Record<string, string>,
): Promise<void> {
  const pipelineDir = join(projectRoot, '.pipeline');
  const evidencePath = join(pipelineDir, 'task-evidence.json');
  const statusPath = join(pipelineDir, 'task-status.json');

  // task-evidence.json
  try {
    const raw = await readFile(evidencePath, 'utf-8');
    const parsed = JSON.parse(raw) as SerializedEvidenceDataLike;

    if (parsed && typeof parsed === 'object' && parsed.evidenceStamps) {
      for (const stamp of Object.values(parsed.evidenceStamps)) {
        if (!stamp || typeof stamp !== 'object') continue;

        if (typeof stamp.sha === 'string') {
          stamp.sha = resolveThroughMap(stamp.sha, map);
        }
        if (Array.isArray(stamp.citedShas)) {
          stamp.citedShas = stamp.citedShas.map((sha) => resolveThroughMap(sha, map));
        }
        if (typeof stamp.verdictAnchor === 'string') {
          stamp.verdictAnchor = resolveThroughMap(stamp.verdictAnchor, map);
        }
      }

      await atomicWriteJson(pipelineDir, evidencePath, 'task-evidence', parsed);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  // task-status.json
  try {
    const raw = await readFile(statusPath, 'utf-8');
    const parsed = JSON.parse(raw) as TaskStatusFileLike;

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
      for (const task of parsed.tasks) {
        if (task && typeof task.commit === 'string') {
          task.commit = resolveThroughMap(task.commit, map);
        }
      }

      await atomicWriteJson(pipelineDir, statusPath, 'task-status', parsed);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Loads the persisted rewrite map from `.pipeline/rebase-rewrites.json`.
 * Returns an empty map if the file is missing, unreadable, or corrupt —
 * read-time consumers (attribution-validate, autoheal) treat "no map" the
 * same as "no rewrites happened," so `resolveThroughMap` is always safe to
 * call unconditionally with the result.
 */
export async function loadRewriteMap(projectRoot: string): Promise<Record<string, string>> {
  const rewritesPath = join(projectRoot, '.pipeline', 'rebase-rewrites.json');

  try {
    const raw = await readFile(rewritesPath, 'utf-8');
    const parsed = JSON.parse(raw) as SerializedRewriteMap;
    if (parsed && typeof parsed === 'object' && parsed.map && typeof parsed.map === 'object') {
      return parsed.map;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persists `map` to `.pipeline/rebase-rewrites.json`, merging transitively
 * with any existing persisted map: if the file already has `old -> mid` and
 * this call adds `mid -> new`, the persisted result repoints `old -> new`
 * directly rather than leaving a stale two-hop chain.
 *
 * Atomic write: unique temp file in the same directory, then rename(2) over
 * the target (mirrors `task-evidence.ts`'s `write()` discipline).
 */
export async function persistRewriteMap(
  projectRoot: string,
  map: Record<string, string>,
): Promise<void> {
  const pipelineDir = join(projectRoot, '.pipeline');
  const rewritesPath = join(pipelineDir, 'rebase-rewrites.json');

  let existing: Record<string, string> = {};
  try {
    const raw = await readFile(rewritesPath, 'utf-8');
    try {
      const parsed = JSON.parse(raw) as SerializedRewriteMap;
      if (parsed && typeof parsed === 'object' && parsed.map && typeof parsed.map === 'object') {
        existing = parsed.map;
      }
    } catch (parseErr) {
      console.warn(
        `[rebase-translate] corrupt or unparseable file at ${rewritesPath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
  } catch {
    // File missing — use empty existing map.
  }

  // Merge new entries into existing, then close transitively: re-resolve
  // every key (old and new) through the merged map so any prior chain
  // (old -> mid) combined with a new hop (mid -> new) collapses to
  // (old -> new) directly.
  const merged: Record<string, string> = { ...existing, ...map };

  const closed: Record<string, string> = {};
  for (const key of Object.keys(merged)) {
    closed[key] = resolveThroughMap(key, merged);
  }

  await mkdir(pipelineDir, { recursive: true });

  const serialized: SerializedRewriteMap = { map: closed };

  const tempFile = join(
    pipelineDir,
    `.rebase-rewrites.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await writeFile(tempFile, JSON.stringify(serialized, null, 2));
    await rename(tempFile, rewritesPath);
  } catch (err) {
    await rm(tempFile, { force: true }).catch(() => {});
    throw err;
  }
}
