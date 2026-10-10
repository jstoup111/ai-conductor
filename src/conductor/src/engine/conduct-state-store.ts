import type {
  NamedAtomicStateMutationBatch,
  PrivilegedStateCorrection,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../types/state.js';
import type { ConductState, StateResult } from '../types/state.js';
import { join } from 'node:path';
import { isRegionStep, pipelinePathFor, type ChildId } from './child-context.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';

export type {
  ConductStateStoreError,
  NamedAtomicStateMutationBatch,
  PrivilegedStateCorrection,
  PrivilegedStateReplacement,
  StateFieldDeletion,
  StateMutation,
  StateMutationOutcome,
  StateMutationResult,
} from '../types/state.js';

/**
 * Authoritative boundary for intent-bearing conduct-state changes.
 * Implementations own persistence and same-field conflict resolution.
 */
export interface ConductStateStore<State extends object> {
  apply(mutation: StateMutation<State>): Promise<StateMutationResult>;
  applyBatch(batch: NamedAtomicStateMutationBatch<State>): Promise<StateMutationResult>;
  /** Optional until every adapter supports recovery's explicit field deletion. */
  applyCorrection?(batch: PrivilegedStateCorrection<State>): Promise<StateMutationResult>;
  replace(replacement: PrivilegedStateReplacement<State>): Promise<StateMutationResult>;
}

/**
 * Read the feature-wide state together with one child's build-region state.
 * Only region steps are overlaid: DECIDE/SHIP metadata remains feature-wide.
 */
export async function readConductStateOverlay(
  root: string,
  child?: ChildId,
): Promise<StateResult<ConductState>> {
  const flat = createFilesystemConductStateStore(join(root, '.pipeline', 'conduct-state.json'));
  const base = await flat.read();
  if (!base.ok || child === undefined) return base;
  const regional = createFilesystemConductStateStore(
    pipelinePathFor(root, 'conduct-state.json', child),
  );
  const region = await regional.read();
  if (!region.ok) return region;
  const regionEntries = Object.entries(region.value).filter(([field]) => isRegionStep(field));
  return { ok: true, value: { ...base.value, ...Object.fromEntries(regionEntries) } };
}

/**
 * Route mutations for acceptance/build/test-suite/review to the active child
 * while retaining all feature-wide state in the legacy flat document.
 */
export function createRoutedConductStateStore(
  root: string,
  child?: ChildId,
): ConductStateStore<ConductState> & { read(): Promise<StateResult<ConductState>> } {
  const flat = createFilesystemConductStateStore(join(root, '.pipeline', 'conduct-state.json'));
  if (child === undefined) return flat;
  const regional = createFilesystemConductStateStore(pipelinePathFor(root, 'conduct-state.json', child));
  const storeFor = (field: string) => isRegionStep(field) ? regional : flat;
  return {
    read: () => readConductStateOverlay(root, child),
    apply: (mutation) => storeFor(mutation.field).apply(mutation),
    async applyBatch(batch) {
      const regionMutations = batch.mutations.filter((mutation) => isRegionStep(mutation.field));
      const flatMutations = batch.mutations.filter((mutation) => !isRegionStep(mutation.field));
      if (regionMutations.length > 0) {
        const result = await regional.applyBatch({ name: batch.name, mutations: regionMutations });
        if (result.kind !== 'applied' && result.kind !== 'idempotent') return result;
      }
      if (flatMutations.length > 0) return flat.applyBatch({ name: batch.name, mutations: flatMutations });
      return { kind: 'applied' };
    },
    async replace(replacement) {
      const region: ConductState = {};
      const feature: ConductState = {};
      for (const [field, value] of Object.entries(replacement.next)) {
        (isRegionStep(field) ? region : feature)[field as keyof ConductState] = value as never;
      }
      const regionResult = await regional.replace({ ...replacement, next: region });
      if (regionResult.kind !== 'applied' && regionResult.kind !== 'idempotent') return regionResult;
      return flat.replace({ ...replacement, next: feature });
    },
  };
}
