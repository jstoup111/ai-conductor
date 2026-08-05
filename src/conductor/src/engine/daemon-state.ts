import type { ConductState, StepName, StepStatus } from '../types/index.js';
import type { BacklogItem } from './daemon.js';
import type { ConductStateStore } from './conduct-state-store.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import { applyStateChanges, requireStateMutation } from './state.js';

/** Resolve daemon-owned front-half steps to their durable state for a tier. */
export function preseedDaemonStepStatuses(
  tier: 'S' | 'M' | 'L' | undefined,
  doneSteps: readonly StepName[],
  skippableForTier: (step: StepName, tier: 'S' | 'M' | 'L') => boolean,
): Record<string, StepStatus> {
  const resolvedTier = tier ?? 'M';
  return Object.fromEntries(
    doneSteps.map((name) => [name, skippableForTier(name, resolvedTier) ? 'skipped' : 'done']),
  );
}

/** Derive daemon-owned defaults without mutating the caller's observed snapshot. */
export function deriveDaemonBaseState(
  observedState: ConductState,
  item: Pick<BacklogItem, 'slug' | 'tier' | 'track'>,
  preseed: (tier: 'S' | 'M' | 'L' | undefined) => Record<string, StepStatus>,
): ConductState {
  const baseState: ConductState = Object.keys(observedState).length > 0
    ? { ...observedState }
    : { complexity_tier: item.tier ?? 'M', track: item.track ?? 'product', feature_desc: item.slug };

  if (!baseState.complexity_tier) baseState.complexity_tier = item.tier ?? 'M';
  Object.assign(baseState, preseed(baseState.complexity_tier));
  if (!baseState.track) baseState.track = item.track ?? 'product';
  if (baseState.track === 'technical') {
    (baseState as Record<string, unknown>).prd = 'skipped';
  }
  if (!baseState.feature_desc) baseState.feature_desc = item.slug;

  return baseState;
}

/** Persist only daemon-owned base fields derived from the observed state. */
export async function persistDaemonBaseState(
  stateFilePath: string,
  observedState: ConductState,
  baseState: ConductState,
  store: ConductStateStore<ConductState> = createFilesystemConductStateStore(stateFilePath),
): Promise<void> {
  const result = await applyStateChanges(
    stateFilePath,
    observedState,
    baseState as Record<string, unknown>,
    'seed daemon feature state',
    store,
  );
  requireStateMutation(result, 'Daemon base-state update');
}
