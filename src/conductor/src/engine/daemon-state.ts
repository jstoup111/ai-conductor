import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConductState, StepName, StepStatus } from '../types/index.js';
import type { BacklogItem } from './daemon.js';
import type { ConductStateStore } from './conduct-state-store.js';
import { preparePipelineForDaemonDispatch } from './daemon-dispatch-preparation.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import { applyStateChanges, readState, requireStateMutation } from './state.js';

// These are the only mechanical daemon bootstrap steps. DECIDE satisfaction
// belongs to Conductor's artifact-backed entry policy, never this preseed.
export const PRESEEDED_DONE: StepName[] = ['worktree', 'memory'];

/** Mark only the mechanical daemon bootstrap steps as durable. */
export function preseedStepStatuses(): Record<string, StepStatus> {
  return Object.fromEntries(PRESEEDED_DONE.map((name) => [name, 'done']));
}

type DaemonSeedItem = Parameters<typeof deriveDaemonBaseState>[1];

/** Derive daemon-owned defaults without mutating the caller's observed snapshot. */
export function deriveDaemonBaseState(
  observedState: ConductState,
  item: Pick<BacklogItem, 'slug' | 'tier' | 'track' | 'applicabilityDeclarations' | 'applicabilityBaseContentSha256' | 'applicabilityIgnored'>,
  preseed: () => Record<string, StepStatus>,
): ConductState {
  const baseState: ConductState = Object.keys(observedState).length > 0
    ? { ...observedState }
    : {
      ...(item.tier ? { complexity_tier: item.tier } : {}),
      track: item.track ?? 'product',
      feature_desc: item.slug,
    };

  if (!baseState.complexity_tier && item.tier) baseState.complexity_tier = item.tier;
  Object.assign(baseState, preseed());
  if (!baseState.track) baseState.track = item.track ?? 'product';
  if (baseState.track === 'technical') {
    (baseState as Record<string, unknown>).prd = 'skipped';
  }
  if (!baseState.feature_desc) baseState.feature_desc = item.slug;
  // A daemon dispatch is always seeded from its base-tree scan. Keeping an
  // empty list is intentional: it distinguishes markerless daemon work from
  // an interactive run, which receives no daemon seed at all.
  baseState.applicability_declarations = item.applicabilityDeclarations ?? [];
  if (item.applicabilityBaseContentSha256) {
    baseState.applicability_base_content_sha256 = item.applicabilityBaseContentSha256;
  } else {
    delete baseState.applicability_base_content_sha256;
  }
  if (item.applicabilityIgnored) {
    baseState.applicability_ignored = item.applicabilityIgnored;
  } else {
    delete baseState.applicability_ignored;
  }

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

/**
 * Prepare a worktree's `.pipeline/` for a daemon dispatch and seed the
 * daemon-owned base state (tier, track, preseeded steps, applicability) from
 * the claimed item. Every daemon executor MUST call this before its Conductor
 * runs: without it the Conductor defaults the track to `product` and walks a
 * technical spec into a PRD it never had.
 *
 * On re-dispatch of a halted feature the observed state is preserved so
 * resume picks up from its real next step. Returns the seeded state.
 */
export async function seedDaemonDispatchState(
  pipelineDir: string,
  item: DaemonSeedItem,
  store?: ConductStateStore<ConductState>,
): Promise<ConductState> {
  // A kept worktree still carries the previous run's `session-created`
  // marker; without this sweep the first step would `--resume` a session id
  // that was never created.
  await mkdir(pipelineDir, { recursive: true });
  await preparePipelineForDaemonDispatch(pipelineDir);
  const stateFilePath = join(pipelineDir, 'conduct-state.json');
  const existing = await readState(stateFilePath);
  const observedState = existing.ok ? existing.value : {};
  const baseState = deriveDaemonBaseState(observedState, item, preseedStepStatuses);
  await persistDaemonBaseState(stateFilePath, observedState, baseState, store);
  return baseState;
}
