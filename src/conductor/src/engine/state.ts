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
    return { ok: true, value: migrateState(parsed) };
  } catch {
    return {
      ok: false,
      error: { type: 'corrupted', message: 'Invalid JSON in state file' },
    };
  }
}

/**
 * Migrate a persisted state to the current schema (ADR-018). Idempotent and
 * non-destructive — safe to run on every load.
 *
 * `brainstorm` was split into `explore` + `prd`. A pre-split state records only
 * `brainstorm`; map it forward so an in-flight or completed feature does not
 * re-run DECIDE work after the rename:
 *   - `explore` := `brainstorm`'s status (the divergent half always ran).
 *   - `prd`     := `brainstorm`'s status. A `done` brainstorm authored a PRD into
 *     `.docs/specs`, so `prd` is `done`; a skipped brainstorm → `prd` skipped.
 * The `brainstorm` key is left in place (harmless — it is no longer scheduled).
 * Steps already carrying `explore`/`prd` are untouched (idempotent).
 */
function migrateState(state: ConductState): ConductState {
  const brainstorm = (state as Record<string, StepStatus | undefined>)['brainstorm'];
  if (!brainstorm) return state;
  const migrated: ConductState = { ...state };
  const m = migrated as Record<string, StepStatus>;
  if (m['explore'] === undefined) m['explore'] = brainstorm;
  if (m['prd'] === undefined) m['prd'] = brainstorm;
  return migrated;
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
 * Store the pull request URL returned by the finish step.
 */
export async function savePrUrl(path: string, url: string): Promise<void> {
  const result = await readState(path);
  const state: ConductState = result.ok ? result.value : {};
  state.pr_url = url;
  await writeState(path, state);
}

/**
 * Pull the first http(s) URL out of free-form stdout. Used as a fallback when
 * the finish skill doesn't write `pr_url` into conduct-state.json directly
 * (e.g. `gh pr create` prints the URL and the skill exits). Matches
 * https://... up to the first whitespace character so we don't trail off into
 * surrounding prose; trailing punctuation like `.` `,` `;` or balanced quotes
 * is stripped.
 */
export function extractPrUrl(output: string): string | null {
  if (!output) return null;
  const match = output.match(/https?:\/\/\S+/);
  if (!match) return null;
  let url = match[0];
  url = url.replace(/[),.;'"!\]]+$/, '');
  return url;
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
