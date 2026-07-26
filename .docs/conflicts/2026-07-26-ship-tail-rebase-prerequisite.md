# Conflict Check: SHIP-tail rebase prerequisite (#922)

**Date:** 2026-07-26
**Verdict:** CLEAN

## Conflict: Rebase prerequisite authority

**Stories involved:** `ship-tail-parallel-validation-serial-publication-922` vs
`phase-9.0-rebase-on-latest`

**Authoritative records involved:**
`adr-2026-07-26-serial-ship-tail-publication` vs
`adr-001-rebase-insertion-mechanism`

**Type:** sequencing
**Severity:** blocking

**Description:**

The older approved ADR explicitly specifies a `manual_test` prerequisite for `rebase`. The newly
approved ADR requires `rebase` to wait for the completed validation tail. Both cannot govern the
same registry prerequisite. The older story's behavioral intent remains compatible: rebase still
runs only after green build and manual test, but it must now wait for the remaining applicable
validation work as well.

**Grounded confidence:** 100% — both prerequisites are stated directly in the two ADRs.

## Resolution Options

1. **Supersede the older rebase ADR with the new ADR, preserving its unmodified decisions.**
   Mark `adr-001-rebase-insertion-mechanism` as superseded by
   `adr-2026-07-26-serial-ship-tail-publication`; expand the newer ADR to state it retains all
   other rebase behavior. This makes one current ADR authoritative for the revised prerequisite.
2. **Replace the new ADR with a comprehensive rebase ADR.**
   Re-document all historic rebase decisions plus the new ordering. This is more complete but
   disproportionate to a one-edge dependency change.
3. **Retain both ADRs without a lifecycle link.**
   Rejected: future readers cannot determine which prerequisite is authoritative.

**Resolved:** Option 2 — `adr-2026-07-26-rebase-tail-current-branch-before-publication` is
operator-approved and supersedes the two prior ADRs. The Phase 9.0 story now names the applicable
SHIP validation tail. No blocking or degrading conflicts remain.

## Compatible Existing Stories

- The validation-group story remains compatible: it retains concurrent validation and only states
  that the all-green tail advances.
- The Phase 9.0 rebase story remains behaviorally compatible after its prerequisite wording is
  narrowed from `build`/`manual_test` to the applicable SHIP validation tail.

## Conflict: Explicit finish targeting versus publication safety

**Stories involved:** `ship-tail-parallel-validation-serial-publication-922` vs
`rekick-resume-runs-finish-while-the-build-gate-ver`

**Authoritative records involved:**
`adr-2026-07-26-rebase-tail-current-branch-before-publication` vs
`adr-2026-07-11-verdict-aware-resume-entry`

**Type:** safety boundary
**Severity:** blocking

**Description:**

The #532 ADR correctly exempts explicit `fromStep` from its resume-entry clamp, but its story and
regression test use `fromStep:'finish'` to assert finish actually dispatches over an unsatisfied
upstream verdict. The #922 publication invariant requires all finish entry paths to prove current-
HEAD validation immediately before dispatch. Navigation authority and publication authority must
be separated.

**Grounded confidence:** 100% — the #532 ADR Decision §3, accepted story, regression test, and the
common finish pre-dispatch branch state the two behaviors directly.

**Resolved:** The operator approved a non-bypassable finish fence on 2026-07-26 while confirming
that the validation group remains parallel. The #532 resume clamp remains unchanged and explicit
`fromStep` still chooses the initial target. The newer comprehensive ADR amends only the implication
that targeting finish guarantees its dispatch: the target must cross the publication fence and may
redirect to concurrent validation. No blocking or degrading conflict remains.
