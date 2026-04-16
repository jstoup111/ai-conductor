import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
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
 * Scan .worktrees/ for active (non-complete) features with their state.
 */
export async function scanResumableFeatures(projectRoot: string): Promise<ResumableFeature[]> {
  const worktreesDir = join(projectRoot, '.worktrees');
  const totalSteps = ALL_STEPS.length;

  let entries: string[];
  try {
    const dirents = await readdir(worktreesDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }

  const results: ResumableFeature[] = [];

  for (const name of entries) {
    const wtPath = join(worktreesDir, name);
    const branch = `feature/${name}`;

    let state: ConductState = {};
    try {
      const raw = await readFile(join(wtPath, 'conduct-state.json'), 'utf-8');
      state = JSON.parse(raw);
    } catch {
      // No state file — include as new worktree
    }

    // Skip completed features
    if (state.feature_status === 'complete') continue;

    // Determine step index from last_step
    const lastStep = state.last_step;
    let stepIndex = 0;
    if (lastStep) {
      const idx = ALL_STEPS.findIndex((s) => s.name === lastStep);
      if (idx >= 0) stepIndex = idx + 1; // +1 because last_step is done
    }

    results.push({
      name,
      path: wtPath,
      branch,
      lastStep: lastStep,
      stepIndex,
      totalSteps,
      featureDesc: state.feature_desc,
    });
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
