# Conflict Report: Child BUILD halts needs-human on another child's already-resolved build-review case

**Date:** 2026-11-15
**New stories:** `.docs/stories/child-build-halts-needs-human-on-another-child-s-a.md` (Stories 1 to 6)
**Result:** Conflict check passed. Two blocking conflicts were found and resolved; none remain.

## Scope examined

**Stories.** Every file in `.docs/stories/` was searched for assertions about the four remediation
inputs, the stall marker, and stall remediation. The files with such assertions were read against
Stories 1 to 6 in both directions:
`daemon-mode-route-halt-user-input-required-through`,
`fence-ship-validator-verdict-artifacts-from-build-`,
`remediation-dispositions-honor-the-engine-owned-in`,
`builds-stall-when-work-lands-without-task-trailer-`,
`build-reports-step-completed-status-done-while-lea`, `trailer-union-build-completion`,
`add-a-judgement-gate-at-the-build-manual-test-seam`,
`parallel-validation-phase-fan-out-manual-test-prd-`,
`inline-build-work-commits-unattributed-session-hoo`,
`remediable-as-built-blocked-verdict-halts-needs-hu`.

**ADRs examined.** `adr-2026-07-10-daemon-stall-remediation`,
`adr-2026-10-03-stacked-child-plans-identity-and-state`, `adr-2026-10-07-per-child-build-region`,
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`,
`adr-2026-07-28-total-halt-classification-legacy-boundary`,
`adr-2026-10-20-operator-acceptance-is-durable-case-state`,
`adr-2026-10-12-routed-whole-feature-repair`.

**ADRs narrowed out.** Every other approved ADR: none addresses the location or lifetime of the
remediation inputs, the BUILD stall marker, or stall remediation routing.
`adr-2026-08-29-build-review-remediate-case-adjudication` is fully superseded and was excluded.

## Conflict: BUILD is directed to read a gap plan the engine has already deleted

**Stories involved:** Story 1 of the SHIP verdict fence vs Stories 2 and 3 of this spec
**Files:** `.docs/stories/fence-ship-validator-verdict-artifacts-from-build-.md` vs `.docs/stories/child-build-halts-needs-human-on-another-child-s-a.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The fence story had the BUILD skills direct a session to read the typed
remediation plan at `.pipeline/remediation-plan.json`. Story 3 as first written deleted that plan
as soon as the engine consumed it, and Story 2 had the skills name no fixed feature-level path.
Satisfying Stories 2 and 3 left the fence criterion unsatisfiable.

**Resolution Options:**
1. Keep the gap plan in the child's region until the BUILD it routed to passes its gate, name its path in the BUILD prompt, and reword the fence criterion to the prompt-named inputs.
2. Keep the gap plan at the feature-level path for the life of the feature.
3. Stop directing BUILD to the gap plan at all.

**Recommendation:** Option 1, because it keeps the plan readable for the one BUILD that needs it and still removes it before any other child's BUILD.

**Resolution (operator, 2026-11-15):** Option 1. The fence criterion, Stories 2 and 3 of this spec, and decision 3 of the new ADR were revised in place.

## Conflict: Every halt-marker stall is routed through remediation at a feature-level evidence path

**Stories involved:** Stories 1 and 5 of this spec vs ADR: daemon stall remediation
**Files:** `.docs/stories/child-build-halts-needs-human-on-another-child-s-a.md` vs `.docs/decisions/adr-2026-07-10-daemon-stall-remediation.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-10-daemon-stall-remediation
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "In **daemon mode only**, route a `halt_marker` build stall through the existing `/remediate` machinery before any HALT:"
**Story opposing sentence (verbatim):** "Given child 3's BUILD stalls with a question naming a case that is resolved in child 4's store, when the engine handles the stall, then no remediation session is dispatched, the stall marker is cleared, and BUILD is dispatched again for child 3 in the same run."

**Description:** The ADR dispatches remediation for every halt-marker stall and fixes the evidence
at `.pipeline/build-stall-question.md`. Story 5 dispatches none for a stale citation, and Story 1
writes the evidence under the active child's region. The matching criteria in
`daemon-mode-route-halt-user-input-required-through.md` asserted the same two things as the ADR.

**Resolution Options:**
1. Amend decisions 1 and 2 of the ADR by note, reword the two matching story criteria, and have the stale-citation HALT carry the question verbatim so decision 5 of the ADR still holds.
2. Leave stale citations going through remediation and rely on the planner to answer them.
3. Supersede the ADR.

**Recommendation:** Option 1, because the ADR's remaining decisions hold and only two assertions change.

**Resolution (operator, 2026-11-15):** Option 1. Amendment notes were added beside decisions 1 and 2 of the ADR, three criteria in the daemon stall stories were reworded in place, and Story 6 now requires the HALT to carry the question verbatim.

## Pairs examined and found compatible

- `remediation-dispositions-honor-the-engine-owned-in` Story on the typed plan: a prior attempt's plan is never accepted, and case adjudication and gap planning never read each other's output. Both still hold with region paths; the remediate session's write path is unchanged.
- The stall-classification stories (`builds-stall-when-work-lands-without-task-trailer-`, `build-reports-step-completed-status-done-while-lea`, `trailer-union-build-completion`): the marker still classifies as `halt_marker` and keeps precedence. This spec acts after classification.
- `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 8 and `adr-2026-10-07-per-child-build-region` decision 4: neither lists the four inputs as region or whole-feature state.
- `adr-2026-10-20-operator-acceptance-is-durable-case-state`: `resolve-case` behavior is unchanged.

## Re-check

Re-run after the resolutions: zero blocking conflicts, zero degrading conflicts.
