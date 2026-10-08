import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { createEngineStateStore } from './engine-state-store.js';

/**
 * SHA-256 of a file's contents, hex encoded. Returns null if the file can't be read.
 */
async function hashFile(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Approval key for an artifact file: path relative to projectRoot (falls back
 * to the absolute path if outside the root).
 */
export function approvalKey(projectRoot: string, file: string): string {
  const rel = relative(projectRoot, file);
  return rel.startsWith('..') ? file : rel;
}

/**
 * Return the subset of `files` that are not yet approved OR whose content has
 * changed since approval. Files whose hash still matches the recorded approval
 * are filtered out (skip re-prompting).
 */
export async function filterUnapprovedArtifacts(
  files: string[],
  approvals: Record<string, { sha256: string; approved_at: string }>,
  projectRoot: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    const key = approvalKey(projectRoot, file);
    const prior = approvals[key];
    if (!prior) {
      out.push(file);
      continue;
    }
    const hash = await hashFile(file);
    if (hash !== prior.sha256) {
      out.push(file);
    }
  }
  return out;
}

/**
 * Record approvals for a list of files. Returns a new approvals map (does not
 * mutate the input). Skips any file that cannot be read.
 */
export async function recordApprovals(
  approvals: Record<string, { sha256: string; approved_at: string }>,
  files: string[],
  projectRoot: string,
): Promise<Record<string, { sha256: string; approved_at: string }>> {
  const out = { ...approvals };
  const now = new Date().toISOString();
  for (const file of files) {
    const hash = await hashFile(file);
    if (!hash) continue;
    const key = approvalKey(projectRoot, file);
    out[key] = { sha256: hash, approved_at: now };
  }
  return out;
}

/**
 * Task 14: Record the active plan path in engine state.
 * The engine-recorded path is used by seedTaskStatus to resolve which plan to use,
 * preventing glob-first guessing when multiple plans exist.
 *
 * @param projectRoot - Project root directory
 * @param planPath - Path to the plan file (relative to projectRoot)
 */
export async function recordActivePlanPath(projectRoot: string, planPath: string): Promise<void> {
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  const engineStatePath = join(pipelineDir, 'engine-state.json');
  const result = await createEngineStateStore(engineStatePath).update((state) => ({
    ...state,
    activePlanPath: planPath,
  }));
  if (!result.ok) {
    throw new Error(`Failed to record active plan path (${result.kind}): ${result.message}`);
  }
}
