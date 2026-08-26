# Conflict Check: OVER_SCOPE multi-finding decision block (#1846)

**Date:** 2026-08-24
**Corpus:** change_set (adr-2026-08-24-over-scope-decision-block-and-durable-refusals; amended
adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback,
adr-2026-08-13-stable-build-review-finding-dispositions)
**Stories scanned:** all 315 files in `.docs/stories/`; 13 files touching HALT/clear/OVER_SCOPE
behavior pair-checked in both directions against the 7 new stories.

## Result: PASS (1 blocking conflict found and resolved in place)

## Conflict: Bare operator clear no longer confers acceptance (RESOLVED)

**Stories involved:** New Story 3 (Machine clears never mint decisions) / Story 2 vs
"prd_audit grades each finding" in the shipped build-review re-judge feature
**Files:** .docs/stories/over-scope-halt-accepts-one-criterion-per-clear-so.md vs
.docs/stories/build-review-re-judges-what-the-plan-architecture-.md
**Type:** contradiction
**Severity:** blocking
**Description:** The shipped story asserted "an over-scope stop that the operator clears to
accept the widening … is recorded as operator-accepted" — a bare clear conferred acceptance.
Under the new design (ADR D3), a clear with `pending` entries records nothing; acceptance
requires an explicit per-entry `accept` edit with a rationale. Both cannot hold. One-directional
(not oscillating): the new behavior fully subsumes the old intent while removing the
clear-equals-accept shortcut.
**Resolution applied (option 1, least disruptive):** superseded assertion replaced in place in
the shipped story file (stories carry no amendment record), now requiring the explicit accept
edit and noting that a bare clear records nothing.

## Checked-clean pairs (both directions)

- Rekick-rename mechanics (daemon-event-driven-wake, operator-park, daemon-halt-reconciliation,
  main-advance-re-kick-sweep, sandbox-auth-expiry-park, audit-trail-write-completeness): the
  rename `HALT` → `HALT.cleared` is unchanged; new Story 3 adds inertness on top — no story
  asserts a machine clear records acceptance. Confidence: verified against quoted lines.
- repeated-build-review "accepted-widenings" render block: that is the commit-trailer `Scope:`
  harvest (distinct type, `per-task-commit-floor.ts`), not the decisions file. No resource
  contention. Confidence: verified via consumer sweep.
- New S4 (refusal blocks with changed halt) vs intake outcome "clearing makes forward progress":
  scoped to *decided* clears; a pending/machine clear legitimately re-fires the same set. Not an
  oscillation — both directions hold under that scoping.
- New S4 unbounded refusal laps vs convergence bound: S4 explicitly defers to the existing
  tree-keyed cumulative bound. No oscillation.
- ADR-vs-story: all 7 stories derive from adr-2026-08-24; no opposing sentences found in the
  change-set corpus.

## Degrading conflicts accepted: none
