import { readdir, readFile } from 'fs/promises';
import { basename, join } from 'path';
import { ALL_STEPS } from './steps.js';
import type { ConductState } from '../types/index.js';
import { FEATURES_DIR, rootPipelineDir } from './feature-paths.js';
import { slugify } from './worktree.js';

export interface ResumableFeature {
  name: string;
  path: string;
  branch: string;
  lastStep?: string;
  stepIndex: number;
  totalSteps: number;
  featureDesc?: string;
}

/**
 * Read a state file at one of the supported locations. Returns empty state if
 * no file exists, or the parsed state (whatever that happens to be).
 */
async function readStateFile(...candidates: string[]): Promise<ConductState> {
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf-8');
      return JSON.parse(raw) as ConductState;
    } catch {
      // Try the next candidate
    }
  }
  return {};
}

function toFeature(
  name: string,
  path: string,
  branch: string,
  state: ConductState,
  totalSteps: number,
): ResumableFeature {
  const lastStep = state.last_step;
  let stepIndex = 0;
  if (lastStep) {
    const idx = ALL_STEPS.findIndex((s) => s.name === lastStep);
    if (idx >= 0) stepIndex = idx + 1; // +1 because last_step is done
  }
  return {
    name,
    path,
    branch,
    lastStep,
    stepIndex,
    totalSteps,
    featureDesc: state.feature_desc,
  };
}

/**
 * Scan for active (non-complete) features.
 *
 * Looks in three places:
 *   1. `projectRoot/.pipeline/features/<slug>/` — pre-worktree state in the
 *      isolated layout. One directory per feature.
 *   2. `projectRoot/.worktrees/<slug>/` — features that made it past the
 *      `worktree` step. Each has its own state file.
 *   3. `projectRoot/.pipeline/conduct-state.json` (or legacy root) — the
 *      pre-isolation layout. Surfaced so a partially-migrated project still
 *      shows the feature in its menu; the migration helper folds it into (1)
 *      on the next run.
 *
 * Features keyed by the same slug across (1)-(3) are de-duplicated, with
 * the worktree taking precedence (it's where the work actually lives once
 * the worktree step has run).
 */
export async function scanResumableFeatures(projectRoot: string): Promise<ResumableFeature[]> {
  const totalSteps = ALL_STEPS.length;
  const results: ResumableFeature[] = [];
  const seenSlugs = new Set<string>();
  const seenPaths = new Set<string>();

  // (1) Per-worktree features take precedence (they hold the live state once
  // the worktree step has run).
  const worktreesDir = join(projectRoot, '.worktrees');
  let worktreeEntries: string[] = [];
  try {
    const dirents = await readdir(worktreesDir, { withFileTypes: true });
    worktreeEntries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    /* no worktrees yet — fine */
  }

  for (const name of worktreeEntries) {
    const wtPath = join(worktreesDir, name);
    const state = await readStateFile(
      join(wtPath, '.pipeline', 'conduct-state.json'),
      join(wtPath, 'conduct-state.json'),
    );
    if (state.feature_status === 'complete') continue;
    // Empty state still counts as a resumable worktree (new/uninitialized).

    results.push(toFeature(name, wtPath, `feature/${name}`, state, totalSteps));
    seenSlugs.add(name);
    seenPaths.add(wtPath);
  }

  // (2) Feature-scoped pre-worktree state under .pipeline/features/<slug>/.
  const featuresDir = join(rootPipelineDir(projectRoot), FEATURES_DIR);
  let featureEntries: string[] = [];
  try {
    const dirents = await readdir(featuresDir, { withFileTypes: true });
    featureEntries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    /* no feature dirs yet — fine */
  }

  for (const slug of featureEntries) {
    if (seenSlugs.has(slug)) continue; // worktree already covers this feature
    const dir = join(featuresDir, slug);
    const state = await readStateFile(join(dir, 'conduct-state.json'));
    if (Object.keys(state).length === 0) continue;
    if (state.feature_status === 'complete') continue;

    results.push(toFeature(slug, projectRoot, '(pre-worktree)', state, totalSteps));
    seenSlugs.add(slug);
    seenPaths.add(dir);
  }

  // (3) Legacy root-level state — surfaced for the brief window between
  // upgrading and the next migration pass.
  const rootState = await readStateFile(
    join(projectRoot, '.pipeline', 'conduct-state.json'),
    join(projectRoot, 'conduct-state.json'),
  );
  if (Object.keys(rootState).length > 0 && rootState.feature_status !== 'complete') {
    const slug = rootState.feature_desc ? slugify(rootState.feature_desc) : '';
    if (!slug || !seenSlugs.has(slug)) {
      results.push(
        toFeature(
          basename(projectRoot),
          projectRoot,
          '(legacy root state)',
          rootState,
          totalSteps,
        ),
      );
      if (slug) seenSlugs.add(slug);
      seenPaths.add(projectRoot);
    }
  }

  return results;
}

/**
 * Select a feature from the scanned list.
 * - If only one feature, auto-selects it (choice is ignored).
 * - If choice is 0, returns null (cancel).
 * - If choice is undefined and multiple features exist, returns null (needs user input).
 * - Otherwise returns the feature at choice-1 index.
 */
export function selectFeature(
  features: ResumableFeature[],
  choice: number | undefined,
): ResumableFeature | null {
  if (features.length === 0) return null;
  if (choice === 0) return null;
  if (features.length === 1) return features[0];

  // Multiple features — need explicit choice
  if (choice === undefined) return null;
  if (choice >= 1 && choice <= features.length) return features[choice - 1];
  return null;
}

/**
 * Format the resume menu for display.
 */
export function formatResumeMenu(features: ResumableFeature[]): string {
  const lines: string[] = ['Active features:'];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const label = f.featureDesc ?? f.name;
    const stepInfo = f.lastStep
      ? `[step ${f.stepIndex}/${f.totalSteps}: ${f.lastStep}]`
      : `[step 0/${f.totalSteps}: not started]`;
    lines.push(`  ${i + 1}) ${label.padEnd(20)} ${stepInfo.padEnd(25)} ${f.branch}`);
  }
  lines.push('  0) Cancel');
  return lines.join('\n');
}
