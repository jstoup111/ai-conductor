import type { ConductState } from '../types/state.js';
import type { StateMutation, StateMutationResult } from './conduct-state-store.js';

/**
 * Determines the outcome of a single intent-bearing state mutation without
 * performing persistence.
 */
export function evaluateConductStateMutation(
  currentValue: unknown,
  mutation: StateMutation<ConductState>,
): StateMutationResult {
  if (Object.is(currentValue, mutation.expected)) {
    return { kind: 'applied' };
  }

  if (Object.is(currentValue, mutation.next)) {
    return { kind: 'idempotent' };
  }

  if (mutation.field === 'feature_status' && currentValue === 'complete') {
    return { kind: 'resolved' };
  }

  return {
    kind: 'conflict',
    message: `Expected ${mutation.field} to match before ${mutation.intent}`,
  };
}
