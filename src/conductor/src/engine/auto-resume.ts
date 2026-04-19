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
    }
  | {
      // The root-level state shows the feature has already passed the
      // `worktree` step, but no actual worktree is present at any of the
      // expected locations. Resuming in main would silently land artifacts
      // in the wrong place. Caller should error out and ask the user to
      // either delete the stale state or recreate the worktree.
      kind: 'orphaned-state';
      stateFilePath: string;
      expectedLocations: string[];
      featureDesc?: string;
    };

/** Conventional locations a worktree for `slug` might live, relative to projectRoot. */
export const WORKTREE_DIR_CONVENTIONS = ['.worktrees', '.claude/worktrees'] as const;

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

async function findExistingWorktree(
  projectRoot: string,
  slug: string,
): Promise<string | null> {
  for (const dir of WORKTREE_DIR_CONVENTIONS) {
    const wtPath = join(projectRoot, dir, slug);
    try {
      await access(wtPath);
      return wtPath;
    } catch {
      // not present — try next convention
    }
  }
  return null;
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
 *      If that state has already passed the `worktree` step
 *      (`state.worktree === 'done'`), execution belongs in a feature
 *      worktree, not at the project root. We probe the conventional
 *      worktree locations (`.worktrees/<slug>` and `.claude/worktrees/<slug>`)
 *      and redirect there if found. If none exists, we surface
 *      `kind: 'orphaned-state'` so the caller can refuse to silently
 *      land artifacts on main — the historical bug where the conductor
 *      kept running with `projectRoot = main`, leaving plans/stories
 *      and the final PR creation orphaned.
 *
 *   2. `.worktrees/<slug>/` and `.claude/worktrees/<slug>/`. Reached when
 *      the feature has already been promoted to its own worktree.
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
      // If state has already passed the worktree step, the actual worktree
      // must exist somewhere — redirect to it. If it doesn't, treat the
      // state as orphaned rather than silently resuming on main.
      if (state.worktree === 'done') {
        const wt = await findExistingWorktree(projectRoot, slug);
        if (wt) {
          const wtLoaded = await loadStateFromCandidates([
            join(wt, '.pipeline', 'conduct-state.json'),
            join(wt, 'conduct-state.json'),
          ]);
          if (wtLoaded) {
            if (wtLoaded.state.feature_status === 'complete') {
              return { kind: 'complete', worktreePath: wt };
            }
            return buildResume(wt, wtLoaded.state, wtLoaded.path);
          }
          // Worktree exists but has no state yet — resume there with the
          // root state we already loaded. (Common when the worktree skill
          // created the directory but state hasn't been copied across.)
          return buildResume(wt, state, path);
        }
        return {
          kind: 'orphaned-state',
          stateFilePath: path,
          expectedLocations: WORKTREE_DIR_CONVENTIONS.map((d) => join(projectRoot, d, slug)),
          featureDesc: state.feature_desc,
        };
      }
      return buildResume(projectRoot, state, path);
    }
    // Root state exists but is for a different feature — fall through to
    // the worktree check. The caller may decide to error/warn if neither
    // path matches and the root state is non-empty.
  }

  // (2) Per-worktree state under either supported worktree directory.
  const worktreePath = await findExistingWorktree(projectRoot, slug);
  if (!worktreePath) return { kind: 'none' };

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
