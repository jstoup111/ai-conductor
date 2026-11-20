# Conflict check for #3419

**Date:** 2026-11-20
**Result:** PASSED after operator resolution on 2026-11-20.

## Criterion references after story edits

The original positional-ID design could silently bind a task to the wrong criterion after insertion. The operator approved persistent IDs for opted-in specs. Story 1 now covers moving, editing and deleting a referenced criterion. Story 4 covers duplicate and dangling references. Both land and audit resolve the same identity; a moved criterion stays reachable and a deleted one is a named failure. Existing positional specs retain their original parser behavior.

## Related contracts

- The August 31 coverage-binding ADR D1 requires verbatim text and quotes in the legacy format. The approved amendment scopes that rule to legacy claims and document reference resolution for opted-in specs. Keep the Small-tier carrier in the executable plan; Medium and Large keep the separate coherence carrier. Existing dispositions and waiver eligibility still apply.
- The September 23 accepted-story readability ADR makes one parser authoritative across gates. The implementation must feed identity and text from that parser to land, audit and review.
- The October 24 manifest and October 28 path-policy decisions, as amended on this branch, distinguish executable plans from summaries. Cleanup can remove both together while historical lookup selects only the executable plan.

Recheck: the decisions now distinguish both format and tier. Human reading, execution, cleanup and historical lookup can each meet their stories without redirecting a live reference. No blocking or accepted degrading conflict remains among the compared contracts.
