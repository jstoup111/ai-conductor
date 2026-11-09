/**
 * A refused-tip pin shares the conflict-record transaction.  Keep the
 * operator-facing diagnosis distinct from the record's generic CAS result:
 * the retained tip is the recovery starting point that was lost to the race.
 */
export function refusedTipPinFailureDetail(recordFailure: string): string {
  return `\nrefused tip could not be pinned${recordFailure}`;
}
