import { readdir, readFile } from 'fs/promises';
import { basename, join } from 'path';
import { ALL_STEPS } from './steps.js';
import type { ConductState } from '../types/index.js';

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
 * Looks in two places:
 *   1. `projectRoot/.worktrees/<slug>/` — features that made it past the
 *      `worktree` step. Each has its own state file.
 *   2. `projectRoot/` itself — the common case BEFORE the worktree step runs,
 *      where `projectRoot/.pipeline/conduct-state.json` (or legacy
 *      `projectRoot/conduct-state.json`) holds the in-progress feature.
 *
 * This lets `--resume` find features that failed early (e.g., at build after
 * many steps done) even if they never got their own worktree.
 */
export async function scanResumableFeatures(projectRoot: string): Promise<ResumableFeature[]> {
  const totalSteps = ALL_STEPS.length;
  const results: ResumableFeature[] = [];
  const seenPaths = new Set<string>();

  // (1) Root-level feature state — features living at projectRoot itself.
  const rootState = await readStateFile(
    join(projectRoot, '.pipeline', 'conduct-state.json'),
    join(projectRoot, 'conduct-state.json'),
  );
  if (Object.keys(rootState).length > 0 && rootState.feature_status !== 'complete') {
    results.push(
      toFeature(
        basename(projectRoot),
        projectRoot,
        '(current branch)',
        rootState,
        totalSteps,
      ),
    );
    seenPaths.add(projectRoot);
  }

  // (2) Per-worktree features under .worktrees/.
  const worktreesDir = join(projectRoot, '.worktrees');
  let entries: string[];
  try {
    const dirents = await readdir(worktreesDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return results;
  }

  for (const name of entries) {
    const wtPath = join(worktreesDir, name);
    if (seenPaths.has(wtPath)) continue;

    const state = await readStateFile(
      join(wtPath, '.pipeline', 'conduct-state.json'),
      join(wtPath, 'conduct-state.json'),
    );
    if (state.feature_status === 'complete') continue;
    // Empty state still counts as a resumable worktree (new/uninitialized).

    results.push(toFeature(name, wtPath, `feature/${name}`, state, totalSteps));
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
