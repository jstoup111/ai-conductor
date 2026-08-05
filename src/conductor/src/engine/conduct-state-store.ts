import type {
  NamedAtomicStateMutationBatch,
  PrivilegedStateCorrection,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../types/state.js';

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
