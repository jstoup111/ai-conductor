import { readFile } from 'fs/promises';
import type { ConductState, StateResult } from '../types/index.js';
import type { StepName, StepStatus, ComplexityTier } from '../types/index.js';
import {
  createFilesystemConductStateStore,
  writeFilesystemConductStateFixture,
} from './filesystem-conduct-state-store.js';
import type {
  ConductStateStore,
  PrivilegedStateCorrection,
  StateMutation,
  StateMutationResult,
} from './conduct-state-store.js';

function resolveStateStore(
  path: string,
  store: ConductStateStore<ConductState> | undefined,
): ConductStateStore<ConductState> {
  return store ?? createFilesystemConductStateStore(path);
}

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
 * Migrate a persisted state to the current schema (adr-2026-06-29-brainstorm-rename-migration). Idempotent and
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
 * Seed a test fixture through the adapter's atomic persistence seam. Production
 * callers use field mutations instead.
 */
export async function writeState(
  path: string,
  state: ConductState,
): Promise<void> {
  await writeFilesystemConductStateFixture(path, state);
}

/** Submit an explicit bounded update batch derived from one observed snapshot. */
export async function applyStateChanges(
  path: string,
  previous: ConductState,
  changes: Record<string, unknown>,
  intent: string,
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  const current = previous as Record<string, unknown>;
  const mutations = Object.entries(changes)
    .filter(([field, next]) => !Object.is(current[field], next))
    .map(([field, next]) => {
      if (next === undefined) {
        throw new Error(`Ordinary state mutation cannot clear ${field}`);
      }
      return {
        field,
        expected: current[field],
        intent,
        next,
      } as StateMutation<ConductState>;
    });

  if (mutations.length === 0) return { kind: 'idempotent' };
  return resolveStateStore(path, store).applyBatch({ name: intent, mutations });
}

/** Perform a deliberately privileged full-state reset/start-over replacement. */
export async function replaceState(
  path: string,
  next: ConductState,
  intent: string,
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  return resolveStateStore(path, store).replace({ intent, next, privileged: true });
}

/** Apply a named correction that needs explicit field-deletion authority. */
export async function applyStateCorrection(
  path: string,
  correction: PrivilegedStateCorrection<ConductState>,
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  const resolved = resolveStateStore(path, store);
  if (!resolved.applyCorrection) {
    return { kind: 'persistence', message: 'State store does not support corrective mutations' };
  }
  return resolved.applyCorrection(correction);
}

/** Convert a typed store failure into an operator-actionable command error. */
export function requireStateMutation(result: StateMutationResult, action: string): void {
  if ('message' in result) {
    throw new Error(`${action} failed (${result.kind}): ${result.message}`);
  }
}

/**
 * Read state, update a step's status and last_step, then write back.
 */
export async function saveStepStatus(
  path: string,
  step: StepName,
  status: StepStatus,
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  const result = await readState(path);
  if (!result.ok) return { kind: 'persistence', message: result.error.message };

  return resolveStateStore(path, store).applyBatch({
    name: 'save step status',
    mutations: [
      {
        field: step,
        expected: result.value[step],
        intent: `save ${step} step status`,
        next: status,
      } as StateMutation<ConductState>,
      {
        field: 'last_step',
        expected: result.value.last_step,
        intent: 'record last completed step',
        next: step,
      },
    ],
  });
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
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  const result = await readState(path);
  if (!result.ok) return { kind: 'persistence', message: result.error.message };

  return resolveStateStore(path, store).apply({
    field: 'complexity_tier',
    expected: result.value.complexity_tier,
    intent: 'store complexity tier',
    next: tier,
  });
}

/**
 * Store the pull request URL returned by the finish step.
 */
export async function savePrUrl(
  path: string,
  url: string,
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  const result = await readState(path);
  if (!result.ok) return { kind: 'persistence', message: result.error.message };

  return resolveStateStore(path, store).apply({
    field: 'pr_url',
    expected: result.value.pr_url,
    intent: 'store pull request URL',
    next: url,
  });
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
export async function markFeatureComplete(
  path: string,
  store?: ConductStateStore<ConductState>,
): Promise<StateMutationResult> {
  const result = await readState(path);
  if (!result.ok) return { kind: 'persistence', message: result.error.message };

  return resolveStateStore(path, store).apply({
    field: 'feature_status',
    expected: result.value.feature_status,
    intent: 'mark feature complete',
    next: 'complete',
  });
}

/**
 * Mark all 'done' steps after targetStep as 'stale'.
 * Pending, failed, and skipped steps are unchanged.
 */
export function markDownstreamStale(
  state: ConductState,
  targetStep: StepName,
  allStepNames: StepName[],
  preserve: readonly StepName[] = [],
): ConductState {
  const targetIndex = allStepNames.indexOf(targetStep);
  const updated = { ...state };
  const preserveSet = new Set(preserve);

  for (let i = targetIndex + 1; i < allStepNames.length; i++) {
    const step = allStepNames[i];
    if (preserveSet.has(step)) continue;
    if (updated[step] === 'done') {
      (updated as Record<string, unknown>)[step] = 'stale';
    }
  }

  return updated;
}
