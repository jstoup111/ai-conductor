# Conflict Report: Refuted build_review finding cycles to a needs-human halt instead of settling

**Date:** 2026-09-09
**Source:** jstoup111/ai-conductor#2409
**Stories checked:** `.docs/stories/refuted-build-review-finding-cycles-to-a-needs-hum.md` (Stories 1–7) against every file in `.docs/stories/`
**ADR corpus:** `conflict_check.adr_corpus: repo_wide` — all 310 `adr-*` files were read in full earlier this DECIDE pass (sweep summary in the spec's explore notes); narrowed here to the ADRs whose subject overlaps these stories.

## ADR corpus

**Examined (subject overlaps the stories):** adr-2026-08-29-build-review-remediate-case-adjudication (superseded; non-conflicting decisions still adopted — retained), adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication, adr-2026-07-13-kickback-build-no-op-escalation, adr-2026-08-13-stable-build-review-finding-dispositions, adr-2026-08-16-closed-build-review-finding-vocabularies, adr-2026-08-18-content-anchored-finding-reference-schema, adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane, adr-2026-08-12-cumulative-build-review-convergence-bound, adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence, adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-08-22-one-owner-per-review-question, adr-2026-08-13-engine-managed-build-review-rubric-branches, adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever, adr-2026-07-28-total-halt-classification-legacy-boundary, adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class, adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-11-halt-events-ride-the-persisted-spine, adr-2026-08-31-coverage-binding-judge-step, adr-2026-09-06-inbound-intake-trust-boundary, adr-2026-08-12-fail-closed-intake-ledger-durability, adr-2026-07-22-canonical-tracker-client-seam, adr-2026-09-07-durable-prd-widening-decision-reconciliation, adr-2026-08-24-evidentiary-defects-are-not-waivable, adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts, adr-2026-09-02-adr-decision-citability-contract, adr-2026-07-21-s-tier-pipeline-knobs.

**Narrowed out:** the remaining ADRs in the corpus (daemon scheduling, park/unpark, intake polling, rebase tails, release gates, self-host boundary, coherence parsing, provider parity, telemetry stack, and every other subject that names no build_review case, disposition, finding, halt class, event, or tracker write). Only adr-2026-08-29-operator-authorized-kickback-budget-recovery was excluded as unambiguously fully superseded; every partial supersession (notably the predecessor adjudication ADR) was retained.

**ADR-versus-story result:** zero conflicts. The four ADRs that would have contradicted Stories 1, 3, 4, and 6 were amended and operator-approved earlier in this pass (D7.1–D7.6, D3.4, D5.3, D2.1, D4.1); each story's opposing behavior is now the ADR's own text. Every other examined ADR constrains the design (evidence grammar, halt class, sink registry, tracker seam, no waiver for evidentiary defects) and each constraint is satisfied by a story criterion — verified by reading the constraining sentence against the story bullet, not assumed.

## Story-versus-story scan

All 21 pairs among Stories 1–7 were tested in both directions ("if A is fully satisfied, does B still hold?"). Pairs sharing a behavior:

| Pair | Shared behavior | A→B | B→A | Result |
|---|---|---|---|---|
| 1 vs 3 | binding an attempted case | holds | holds | clean — `refute` settles, `act` halts, disjoint dispositions |
| 3 vs 4 | already-refuted case | holds after Story 3 was tightened (below) | holds | clean |
| 4 vs 5 | refuted case with a residual | holds | holds | clean — an unfinished residual blocks settlement in both |
| 1 vs 5 | refute effect shape | holds | holds | clean — `none` or complete deferral, never action |
| 2 vs 5 | deferral validation | holds | holds | clean — same invalid-deferral reason |
| 6 vs 7 | rendering vs emission | holds | holds | clean — different consumers of the same record |

**Tightened in place (phrasing, not a conflict):** Story 3's second-refutation criterion originally read as if the refuted source itself could be re-bound; Story 4 excludes that source from the live set, so the binding can only arrive through a live source with a different id. The criterion now says so. No oscillation: Story 4 fully satisfied leaves Story 3 satisfiable, and vice versa.

## Conflict: Shipped adjudicator story asserts the attempted-rebind halt without the refutation carve-out

**Stories involved:** Story 1 (A refuted re-raise settles the lap instead of halting) and Story 4 (A refuted case stays settled on later laps) vs the shipped negative paths of `build-review-rubrics-need-a-post-join-adjudicator-` (#2033, shipped)
**Files:** `.docs/stories/refuted-build-review-finding-cycles-to-a-needs-hum.md` vs `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md`
**Type:** contradiction
**Severity:** degrading
**Story opposing sentence (verbatim, shipped story):** "Given BUILD already attempted an action case and a later complete lap binds a current finding to that unresolved case, when routing is derived, then no new or free BUILD route occurs and the gate halts `needs-human` with both current and prior evidence even if the tree moved." and "Given an action case was marked resolved and an equivalent finding reappears, when reconciliation runs, then the gate halts as a regression of the prior case rather than resetting its history or consuming another kickback."
**Story opposing sentence (verbatim, this spec):** "Given an attempted case and a new lap whose rubric re-raises the same source id, when the judge binds that case with a `refute` row [...] then the lap routes PASS" and "Given a case resolved by refutation, when a later lap re-raises the same source id, then no regression halt is written for that case"

**Description:** The shipped story states the pre-amendment ADR rule unconditionally: every binding of an attempted case halts, and every reappearance of a resolved case halts as a regression. This spec carves out the admitted `refute` binding (no halt, no route) and the refuted terminal (excluded from the live set, no regression halt). Both cannot be the acceptance contract at once. The root is the design, and the design has already been reconciled: the governing ADRs were amended and approved (D7.1–D7.5, D3.4, D5.3), so the shipped story text is the stale party. Note the shipped story's "no new or free BUILD route" clause is preserved by this spec — a refutation grants no route.

**Resolution Options:**
1. Replace the two superseded assertions in the shipped story in place so they read "binds a current finding to that unresolved case with any disposition other than an admitted `refute` row" and "an equivalent finding reappears for a case not resolved by refutation" — shipped as a companion main-based PR, because this spec branch's land gate rejects story edits under a foreign stem.
2. Leave the shipped story untouched and rely on the amended ADRs as the sole authority.
3. Re-derive the shipped story from scratch against the amended ADRs.

**Recommendation:** Option 1 — the ADRs already govern, so the correction is mechanical; a companion PR keeps this spec landable and leaves no stale acceptance text for a later as-built review to grade against. Until that PR merges the conflict is degrading, not blocking: no gate reads the shipped story's negative paths against this feature's diff.

## Result

Conflict check passed: zero blocking conflicts. One degrading contradiction with a shipped story, resolved by ADR amendment with the story correction routed to a companion main-based PR. One in-place phrasing tightening in Story 3.
