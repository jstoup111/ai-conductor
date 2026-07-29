# Conflict Check: total HALT classification with legacy compatibility (#1077)

**Date:** 2026-07-28
**New stories:** `.docs/stories/most-conductor-halts-carry-no-class-sidecar-so-the.md`
**Result:** PASSED — 1 blocking policy conflict found and resolved; 0 blocking conflicts remain

## Inventory and method

The repository inventory covered 263 story files, 40 active specification files, and 137 prior
conflict reports. Candidate interactions were selected from every artifact that mentions HALT
creation, class state, re-kick eligibility, operator parking, processed-work guards, or daemon
startup sequencing. Each candidate was checked for contradiction, behavioral overlap, state
conflict, resource contention, and sequencing conflict.

## Resolved conflict: absence meant both historical compatibility and current retry authority

**Stories involved:** #1077 Stories 1–4 vs #921 TR-1–TR-3 and #551 S5

**Files:**

- `.docs/stories/most-conductor-halts-carry-no-class-sidecar-so-the.md`
- `.docs/stories/main-advance-re-kick-sweep-wipes-needs-human-decid.md`
- `.docs/stories/daemon-mode-kickbacks-route-human-judgment-gaps-in.md`

**Type:** contradiction and state conflict

**Severity:** blocking

**Confidence:** 99% — the acceptance text assigned opposite sweep outcomes to the same missing or
invalid class state.

**Description:** #921 required missing, unreadable, and unrecognized class state to be logged as
`unclassified` and auto-re-kicked. #551 used that auto-clear behavior as the negative witness for a
bare HALT write. The approved #1077 ADR requires post-boundary `unclassified` state to be retained,
while preserving historical behavior only for markers explicitly stamped `legacy`. Both outcomes
could not remain authoritative.

### Resolution options presented

1. Amend the older stories to use explicit `legacy` compatibility and fail-closed
   `unclassified` behavior.
2. Weaken #1077 and continue auto-re-kicking unclassified HALTs.
3. Add a runtime compatibility flag and maintain both policies.

**Operator selection:** Option 1.

### Resolution applied

- #921 now requires pre-boundary markers to be stamped and logged as `legacy`; missing, unreadable,
  and unknown post-boundary state is retained as `unclassified`.
- #921 now requires all current writers, including mechanical writers, to persist an explicit
  writable class. A failed class write leaves a safe retained marker.
- #551 still catches a bare writer without relying on auto-clear: its exact sidecar assertion must
  fail even though the fail-closed sweep also retains the malformed marker.
- The replacement ADR is approved and ADR-013 is marked superseded, so design authority matches the
  reconciled acceptance contracts.

## Re-check

- **Contradiction:** Clean. Every current missing/invalid class path retains; only `mechanical` and
  migration-stamped `legacy` paths retry.
- **Behavioral overlap:** Clean. #984 and #551's specific `needs-human` conversions become entries in
  #1077's complete writer inventory rather than competing writers.
- **State conflict:** Clean. Writable classes (`needs-human`, `mechanical`) and read dispositions
  (`needs-human`, `mechanical`, `legacy`, `unclassified`) are disjoint and total.
- **Resource contention:** Clean. Retained `needs-human` and `unclassified` worktrees intentionally
  consume operator attention; existing visibility, parking, and processed-work guards are unchanged.
- **Sequencing:** Clean. The compatibility boundary runs under the existing project lock before
  discovery, dispatch, or re-kick, and records completion last.

No degrading conflict remains.
