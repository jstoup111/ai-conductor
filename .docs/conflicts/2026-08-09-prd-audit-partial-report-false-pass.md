# Conflict Report: prd_audit passes on a partial report

**Date:** 2026-08-09
**Corpus scanned:** the 8 stories in `.docs/stories/prd-audit-partial-report-false-pass.md`,
`adr-2026-08-09-prd-audit-coverage-complete-manifest`, and the existing `.docs/decisions/` ADR
corpus for prior decisions binding `prd_audit` (notably the `#817` gate-code-validity and `#655`
delta-aware rebase preservation decisions).
**Pairs tested:** all 28 story pairs, each in **both** directions ("if A is fully satisfied, does
B still hold?"). 2 blocking conflicts found and resolved; 0 degrading accepted.
**Status after resolution:** PASSED CLEAN

---

## Conflict 1: One boolean is asked to mean both "trustworthy verdict" and "keep the file"

**Stories involved:** Story 2 (partial audit not spared as authoritative) vs Story 7 (partial audit
resumes when code is unchanged)
**Files:** both in `.docs/stories/prd-audit-partial-report-false-pass.md`
**Type:** oscillating
**Severity:** blocking

**Description:**

Both stories target the same return value — `sweptArtifactStillValid` at `artifacts.ts:681` — and
the bidirectional test returns "no" in both directions:

- **Satisfy Story 2 fully:** the function returns false for an incomplete manifest, so the
  stale-evidence sweep deletes it. Story 7's requirement that the manifest "survives on disk so the
  skill audits only the FRs lacking a verdict" is then unsatisfiable. **No.**
- **Satisfy Story 7 fully:** an incomplete manifest with an unchanged surface is spared from
  deletion, which means the function returned true for an incomplete audit. Story 2's requirement
  that an incomplete audit is never treated as valid is then violated. **No.**

Two "no" answers is an oscillation, not an ordinary contradiction. Nothing looks wrong at authoring
time — each story is individually reasonable and individually implementable — but there is no
implementation satisfying both, so no amount of rework finds one. Left undetected this would surface
as unexplained kickback churn during BUILD: a fix for the sweep breaks resume, the fix for resume
re-opens the false-pass hole, and each lap costs a full agent session.

**Root cause and routing (§5c): the design, not the story phrasing.** The approved ADR named
`sweptArtifactStillValid` as the resume seam because it already consults
`gateVerdictStillValid` — which is true and useful — but did not notice that the function's single
boolean return is simultaneously the *validity* signal consumed elsewhere. The ADR conflated
"should this file stay on disk" with "is this a finished verdict I can trust". That is a missing
seam in the design, so this routes to **`architecture` in amendment mode**, not to story rewording.

**Resolution Options:**

1. **Split the sweep decision from the validity decision.** Make the sweep outcome three-valued —
   `spare-as-valid` (complete, non-blocking, stamp validates), `spare-for-resume` (incomplete, stamp
   validates, retained solely as resume input and never reported as a verdict), `delete` (anything
   else) — while "is this a trustworthy verdict" remains the separate completeness question all four
   sites ask. Least disruptive to the stories; requires an additive ADR amendment.
2. **Drop partial resume entirely.** Always delete an incomplete manifest. Restores a single
   boolean, but discards the operator's explicit requirement that an unchanged implementation
   re-audits only the missing FRs, and makes every straggler cost a full re-audit.
3. **Move the manifest outside the swept path.** Write resume state to a path the sweep does not
   manage. Keeps the boolean, but introduces a second artifact whose lifecycle no existing machinery
   governs — and re-creates the fail-open risk at the new path.

**Recommendation:** Option 1. It is the only option that keeps both properties, and it makes
explicit a distinction the design already depended on implicitly. Option 2 sacrifices a stated
requirement to a self-imposed constraint; Option 3 trades one boolean for an ungoverned artifact,
which is how the original defect was born.

**Resolution applied:** Option 1. `adr-2026-08-09-prd-audit-coverage-complete-manifest` amended
additively (decision 3), and Story 2 and Story 7 updated to reference the three-valued sweep outcome
explicitly rather than leaving the interaction to prose.

---

## Conflict 2: Undefined precedence when an audit is both incomplete and carries a blocking gap

**Stories involved:** Story 4 (classifier reports incompleteness alongside a blocking verdict) vs
Story 6 (incompleteness re-dispatches `prd_audit`; `impl-gap` routes to BUILD; `intended-drift`
halts)
**Files:** both in `.docs/stories/prd-audit-partial-report-false-pass.md`
**Type:** state-conflict
**Severity:** blocking

**Description:**

Story 4 explicitly requires that incompleteness and a blocking verdict can be reported together
without either masking the other. Story 6 assigns each condition a *different* destination —
incompleteness back to `prd_audit`, `impl-gap` to BUILD, `intended-drift` to a halt. Neither story
says which destination wins when both conditions hold simultaneously, which is entirely reachable:
an audit killed after recording one `impl-gap` verdict is both incomplete and carrying a blocking
gap.

The implementer cannot satisfy both destinations for one routing decision and would have to guess.
This is the precise failure shape recorded in intake #1391 — approved DECIDE artifacts requiring
incompatible behavior for the same surface, discovered mid-BUILD at the point where it becomes
load-bearing, costing an operator round-trip. Classifying it now is the whole point of running this
check before `/plan`.

**Resolution Options:**

1. **Incompleteness takes precedence.** When both hold, re-dispatch `prd_audit`; the blocking
   verdicts are preserved (Story 7 already requires this) and are re-evaluated once coverage is
   complete. Rationale: a gap picture drawn from a partial audit is not yet trustworthy enough to
   route on — routing to BUILD on it risks fixing the wrong thing while unaudited FRs stay unknown.
2. **The blocking gap takes precedence.** Route to BUILD (or halt) immediately on the gaps known so
   far, and re-audit afterwards. Gets a head start on a real gap, but dispatches BUILD on an
   incomplete picture and can produce a second kickback the moment the remaining FRs are audited.
3. **Halt whenever both hold.** Unambiguous and safe, but forfeits the self-healing that motivated
   the routing decision in the first place.

**Recommendation:** Option 1. It preserves the ADR's stated reason for routing incompleteness away
from BUILD — BUILD cannot close an unfinished-audit gap — and it avoids acting on a gap picture the
system itself does not yet consider complete. The cost is one extra audit cycle before a genuine gap
reaches BUILD, which is bounded by the serial retry budget.

**Resolution applied:** Option 1. Story 4 and Story 6 updated with an explicit precedence criterion;
the ADR amended additively to record the precedence rule as part of decision 2.

---

## Pairs tested clean (no conflict)

| Pair | Bidirectional result |
|---|---|
| Story 1 ↔ Story 7 | Story 7's negative path already subordinates a resumed run to Story 1's coverage check; both hold in both directions |
| Story 1 ↔ Story 5 | Story 5 adds a block reason to Story 1's predicate; a superset roster still satisfies both |
| Story 2 ↔ Story 3 | Same completeness question at two distinct sites; no shared return value |
| Story 3 ↔ Story 8 | Story 3 re-dispatches a stamped-but-incomplete audit; Story 8 preserves a stamped **complete** audit — disjoint preconditions |
| Story 5 ↔ Story 8 | A complete, matching roster adds no friction to the clean path |
| Story 6 ↔ Story 8 | Story 6 governs unsatisfied gates only; Story 8 governs the satisfied path |
| Story 1 ↔ Story 4 | Predicate and classifier consume one shared completeness answer, no divergent requirement |
| Remaining 21 pairs | No shared behavior, entity, field, or gate |

## Notes on the existing ADR corpus

No conflict with `#817` gate-code-validity: this work consumes `gateVerdictStillValid` as designed
and adds no competing invalidation authority. No conflict with `#655` delta-aware rebase
preservation: Story 8 pins its behavior for a complete audit in both the preserve and invalidate
directions, and incompleteness only ever moves the outcome toward *more* auditing, never less.
