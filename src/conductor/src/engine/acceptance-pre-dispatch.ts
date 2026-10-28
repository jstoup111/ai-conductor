/**
 * What `acceptance_specs` settled before its ordinary dispatch loop.
 *
 * - `not-attempted`: neither pre-dispatch path ran or finished; the RED
 *   self-heal may still run and the dispatch loop runs normally.
 * - `red-healed`: committed specs' RED evidence was repaired and re-verified.
 * - `routed-verified`: a routed host's observed green contract was verified.
 * - `routed-refused`: a routed host's verify-green was attempted and refused.
 *   That observation is the only authority for the pass, so it neither falls
 *   through to the RED self-heal nor dispatches the step.
 */
export type AcceptancePreDispatchOutcome =
  | { readonly kind: 'not-attempted' }
  | { readonly kind: 'red-healed' }
  | { readonly kind: 'routed-verified' }
  | { readonly kind: 'routed-refused' };

/** Only a pass no pre-dispatch path has settled may try the RED self-heal. */
export function permitsAcceptanceRedSelfHeal(outcome: AcceptancePreDispatchOutcome): boolean {
  switch (outcome.kind) {
    case 'not-attempted': return true;
    case 'red-healed':
    case 'routed-verified':
    case 'routed-refused': return false;
  }
}

/** A settled pre-dispatch outcome, successful or refused, bypasses the dispatch loop. */
export function bypassesAcceptanceDispatch(outcome: AcceptancePreDispatchOutcome): boolean {
  return !permitsAcceptanceRedSelfHeal(outcome);
}
