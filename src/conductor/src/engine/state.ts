import { readFile, writeFile } from 'fs/promises';
import type { ConductState, StateResult } from '../types/index.js';
import type { StepName, StepStatus, ComplexityTier } from '../types/index.js';

/**
 * Read conduct-state.json. Returns default empty state if file missing.
 * Returns error for corrupted/empty JSON.
 */
export async function readState(path: string): Promise<StateResult<ConductState>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, value: {} };
    }
    return {
      ok: false,
      error: { type: 'io_error', message: `Failed to read state: ${err}` },
    };
  }

  if (!raw.trim()) {
    return {
      ok: false,
      error: { type: 'corrupted', message: 'State file is empty' },
    };
  }

  try {
    const parsed = JSON.parse(raw) as ConductState;
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      error: { type: 'corrupted', message: 'Invalid JSON in state file' },
    };
  }
}

/**
 * Write conduct-state.json with 2-space indent and trailing newline
 * (matches bash format for backward compat).
 */
export async function writeState(path: string, state: ConductState): Promise<void> {
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/**
 * Read state, update a step's status and last_step, then write back.
 */
export async function saveStepStatus(
  path: string,
  step: StepName,
  status: StepStatus,
): Promise<void> {
  const result = await readState(path);
  const state: ConductState = result.ok ? result.value : {};
  state[step] = status;
  state.last_step = step;
  await writeState(path, state);
}

/**
 * Get a step's status from state. Returns 'pending' if not present.
 */
export function getStepStatus(state: ConductState, step: StepName): StepStatus {
  return state[step] ?? 'pending';
}

/**
 * True only for 'done' and 'skipped'.
 */
export function stepDone(state: ConductState, step: StepName): boolean {
  const status = getStepStatus(state, step);
  return status === 'done' || status === 'skipped';
}

/**
 * True for 'done', 'skipped', AND 'stale' (critical for gates).
 */
export function stepSatisfied(state: ConductState, step: StepName): boolean {
  const status = getStepStatus(state, step);
  return status === 'done' || status === 'skipped' || status === 'stale';
}

/**
 * Store complexity tier in state.
 */
export async function setComplexityTier(
  path: string,
  tier: ComplexityTier,
): Promise<void> {
  const result = await readState(path);
  const state: ConductState = result.ok ? result.value : {};
  state.complexity_tier = tier;
  await writeState(path, state);
}

/**
 * Mark feature as complete.
 */
export async function markFeatureComplete(path: string): Promise<void> {
  const result = await readState(path);
  const state: ConductState = result.ok ? result.value : {};
  state.feature_status = 'complete';
  await writeState(path, state);
}

/**
 * Mark all 'done' steps after targetStep as 'stale'.
 * Pending, failed, and skipped steps are unchanged.
 */
export function markDownstreamStale(
  state: ConductState,
  targetStep: StepName,
  allStepNames: StepName[],
): ConductState {
  const targetIndex = allStepNames.indexOf(targetStep);
  const updated = { ...state };

  for (let i = targetIndex + 1; i < allStepNames.length; i++) {
    const step = allStepNames[i];
    if (updated[step] === 'done') {
      (updated as Record<string, unknown>)[step] = 'stale';
    }
  }

  return updated;
}
