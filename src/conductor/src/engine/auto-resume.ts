import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConductState } from '../types/index.js';
import { readState } from './state.js';
import { ALL_STEPS } from './steps.js';
import { slugify } from './worktree.js';

export type AutoResumeResult =
  | { kind: 'none' }
  | { kind: 'complete'; worktreePath: string }
  | {
      kind: 'resume';
      worktreePath: string;
      stateFilePath: string;
      lastStep?: string;
      totalSteps: number;
      stepIndex: number;
      featureDesc?: string;
    };

interface LoadedState {
  state: ConductState;
  path: string;
}

/**
 * Try each candidate path in order; return the first that yields non-empty state.
 */
async function loadStateFromCandidates(paths: string[]): Promise<LoadedState | null> {
  for (const p of paths) {
    const r = await readState(p);
    if (r.ok && Object.keys(r.value).length > 0) {
      return { state: r.value, path: p };
    }
  }
  return null;
}

function buildResume(
  worktreePath: string,
  state: ConductState,
  statePath: string,
): AutoResumeResult {
  const lastStep = state.last_step;
  const idx = lastStep ? ALL_STEPS.findIndex((s) => s.name === lastStep) : -1;
  return {
    kind: 'resume',
    worktreePath,
    stateFilePath: statePath,
    lastStep,
    totalSteps: ALL_STEPS.length,
    stepIndex: idx >= 0 ? idx + 1 : 0,
    featureDesc: state.feature_desc,
  };
}

/**
 * Decide whether an in-progress feature already exists for `featureDesc` so
 * the caller can silently redirect into it and flip into resume mode.
 *
 * Checked in this order:
 *
 *   1. `projectRoot/.pipeline/conduct-state.json` (or legacy
 *      `projectRoot/conduct-state.json`) — state that lives at the project
 *      root BEFORE the `worktree` step runs. Only claimed as a match if the
 *      persisted `feature_desc` equals the one passed in.
 *
 *   2. `.worktrees/<slug>/.pipeline/conduct-state.json` (or legacy worktree
 *      root). Reached when the feature has already been promoted to its own
 *      worktree.
 *
 * `kind: 'complete'` short-circuits if either location shows the feature has
 * shipped. `kind: 'none'` when nothing matches.
 */
export async function detectAutoResume(
  projectRoot: string,
  featureDesc: string,
): Promise<AutoResumeResult> {
  const slug = slugify(featureDesc);
  if (!slug) return { kind: 'none' };

  // (1) Root-level state — pre-worktree path. Only resume if the stored
  // feature_desc matches the input, to avoid hijacking an unrelated in-progress
  // feature.
  const rootLoaded = await loadStateFromCandidates([
    join(projectRoot, '.pipeline', 'conduct-state.json'),
    join(projectRoot, 'conduct-state.json'),
  ]);
  if (rootLoaded) {
    const { state, path } = rootLoaded;
    if (state.feature_desc === featureDesc) {
      if (state.feature_status === 'complete') {
        return { kind: 'complete', worktreePath: projectRoot };
      }
      return buildResume(projectRoot, state, path);
    }
    // Root state exists but is for a different feature — fall through to
    // the worktree check. The caller may decide to error/warn if neither
    // path matches and the root state is non-empty.
  }

  // (2) Per-worktree state under .worktrees/<slug>/.
  const worktreePath = join(projectRoot, '.worktrees', slug);
  try {
    await access(worktreePath);
  } catch {
    return { kind: 'none' };
  }

  const wtLoaded = await loadStateFromCandidates([
    join(worktreePath, '.pipeline', 'conduct-state.json'),
    join(worktreePath, 'conduct-state.json'),
  ]);
  if (!wtLoaded) return { kind: 'none' };

  if (wtLoaded.state.feature_status === 'complete') {
    return { kind: 'complete', worktreePath };
  }
  return buildResume(worktreePath, wtLoaded.state, wtLoaded.path);
}
