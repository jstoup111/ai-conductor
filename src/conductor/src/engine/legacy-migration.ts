import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readState, writeState } from './state.js';
import { featurePipelineDir, projectStatePath, rootPipelineDir } from './feature-paths.js';
import { patchProjectState, readProjectState } from './project-state.js';
import { slugify } from './worktree.js';
import type { BootstrapMode } from '../types/index.js';

/**
 * One-time migration: convert the pre-isolation layout
 *
 *   .pipeline/conduct-state.json
 *   .pipeline/conduct-session-id
 *   .pipeline/events.jsonl
 *
 * into per-feature directories
 *
 *   .pipeline/features/<slug>/conduct-state.json
 *   .pipeline/features/<slug>/conduct-session-id
 *   .pipeline/features/<slug>/events.jsonl
 *   .pipeline/project-state.json    (bootstrap_mode hoisted here)
 *
 * Idempotent: a second invocation finds nothing to move and returns a
 * no-op result.
 *
 * The migration only runs when the legacy state file carries a
 * `feature_desc`. Without one we have no slug to key the new directory by;
 * the file is left in place and the user can delete it manually with
 * `--reset` if it confuses subsequent runs.
 */
export interface MigrationResult {
  ran: boolean;
  reason?:
    | 'no_legacy_state'
    | 'feature_desc_missing'
    | 'feature_desc_collision'
    | 'success';
  slug?: string;
  movedFiles?: string[];
}

export async function migrateLegacyPipelineLayout(
  projectRoot: string,
): Promise<MigrationResult> {
  const root = rootPipelineDir(projectRoot);
  const legacyStatePath = join(root, 'conduct-state.json');
  const legacySessionPath = join(root, 'conduct-session-id');
  const legacyEventsPath = join(root, 'events.jsonl');

  if (!(await fileExists(legacyStatePath))) {
    return { ran: false, reason: 'no_legacy_state' };
  }

  const stateResult = await readState(legacyStatePath);
  if (!stateResult.ok) {
    return { ran: false, reason: 'no_legacy_state' };
  }
  const state = stateResult.value;
  const featureDesc = state.feature_desc;
  if (!featureDesc) {
    return { ran: false, reason: 'feature_desc_missing' };
  }

  const slug = slugify(featureDesc);
  const targetDir = featurePipelineDir(projectRoot, slug);
  const targetState = join(targetDir, 'conduct-state.json');

  // Refuse to clobber a feature directory that's already been initialized.
  if (await fileExists(targetState)) {
    return { ran: false, reason: 'feature_desc_collision', slug };
  }

  await mkdir(targetDir, { recursive: true });

  // Hoist bootstrap_mode into project-state.json before moving the rest.
  // We strip it from the feature state so the per-feature file is purely
  // per-feature going forward.
  const bootstrap_mode = state.bootstrap_mode;
  if (bootstrap_mode) {
    const existing = await readProjectState(projectStatePath(projectRoot));
    if (!existing.bootstrap_mode) {
      await patchProjectState(projectStatePath(projectRoot), {
        bootstrap_mode: bootstrap_mode as BootstrapMode,
      });
    }
    delete state.bootstrap_mode;
  }

  // Drop vestigial bootstrap/assess step status keys (no longer used —
  // bootstrap and assess are project-prelude concerns now).
  delete (state as Record<string, unknown>).bootstrap;
  delete (state as Record<string, unknown>).assess;

  // Write the feature's state to its new home.
  await writeState(targetState, state);

  const moved: string[] = [targetState];

  // Move (rename) session id and events log if they exist.
  if (await fileExists(legacySessionPath)) {
    const dest = join(targetDir, 'conduct-session-id');
    await rename(legacySessionPath, dest);
    moved.push(dest);
  }
  if (await fileExists(legacyEventsPath)) {
    const dest = join(targetDir, 'events.jsonl');
    await rename(legacyEventsPath, dest);
    moved.push(dest);
  }

  // Remove the legacy state file last, after every move succeeded.
  await rm(legacyStatePath, { force: true });

  return { ran: true, reason: 'success', slug, movedFiles: moved };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
