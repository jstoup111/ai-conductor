# Conflict Check: plan-tasks-lack-falsifiable-done-criteria-so-revie

**Date:** 2026-08-21
**Stories checked:** `.docs/stories/plan-tasks-lack-falsifiable-done-criteria-so-revie.md` (Stories 1–7)
pairwise, plus against every other file in `.docs/stories/` sharing a behavior, entity, field, or
gate — in particular `review-infrastructure-failures-are-operator-unreco.md` (#1629, in flight),
`plan-tasks-can-declare-a-protected-artifact-outcom.md` (#1750, in flight),
`harden-intake-ledger-durability.md`, `repeated-build-review-semantic-failures-can-churn-.md`,
`post-rebase-invalidation-re-runs-every-judged-gate.md`,
`tautology-rubric-grades-diff-required-fixture-relo.md`, `retry-as-escalation.md`.
**ADR corpus:** `repo_wide` (config). Examined: the full `.docs/decisions/` sweep recorded in
`architecture-review-2026-08-21-plan-tasks-lack-falsifiable-done-criteria-so-revie.md` (504 files),
narrowed to the ADRs whose subject overlaps these stories: adr-2026-08-13-stable-build-review-finding-dispositions,
adr-2026-08-13-engine-managed-build-review-rubric-branches, adr-2026-08-16-closed-build-review-finding-vocabularies,
adr-2026-08-16-preservation-anchored-completeness-exemption, adr-2026-08-18-content-anchored-finding-reference-schema,
adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane (PR #1734 branch), adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence,
adr-2026-08-19-engine-stamped-rubric-judged-result-envelope, adr-2026-08-12-cumulative-build-review-convergence-bound,
adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts, adr-2026-07-22-coherence-gate-placement-and-validation-split,
adr-2026-08-12-fail-closed-intake-ledger-durability, adr-2026-07-21-intake-only-enforcement, adr-012, adr-009,
adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-07-23-build-review-fresh-base-disposition,
adr-2026-08-12-removal-anchored / 08-15-verify-only (plan-task-block parsers). Narrowed out: every
other ADR (no shared behavior, entity, field, or gate). Supersession: adr-2026-08-17-build-review-rubric-repetition-short-circuit
is unambiguously fully SUPERSEDED (withdrawn, never implemented) and was excluded; no partial
supersession was encountered among the examined set.
**Result:** 0 blocking, 1 degrading (accepted by operator — see below), 3 examined overlaps found compatible.

## Conflict: "A judged finding blocks exactly as today" vs beyond findings leaving the blocking set

**Stories involved:** Story 4 (Beyond findings never block) vs #1629 Story 11 (A real finding still blocks)
**Files:** `.docs/stories/plan-tasks-lack-falsifiable-done-criteria-so-revie.md` vs `.docs/stories/review-infrastructure-failures-are-operator-unreco.md`; and vs `.docs/decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md` (on main since spec PR #1724)
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "`unresolvedFindingIds` is untouched, so a rubric that ran and found something blocks exactly as today."
**Story opposing sentence (verbatim):** "Given a lap whose only findings are beyond, when the effective verdict is derived, then the verdict is PASS, the beyond findings are listed separately, no kickback is consumed, and no convergence counter advances."

**Description:** #1629 asserts that every judged finding stays in `unresolvedFindingIds` and blocks;
this feature introduces a third finding class (`beyond`) that is judged yet not unresolved. Both
directions: fully satisfying Story 4 falsifies the literal "exactly as today"; fully satisfying
#1629 Story 11 as worded leaves Story 4 unsatisfiable. Not an oscillation — the second direction
is only a wording scope, not a behavioral gate: #1629's intent (Story 11 title, D8 rationale) is that
*reduced coverage* can never suppress a finding, which Story 4 preserves (its negative paths keep
unbound findings blocking, keep `accept` refusing beyond, and keep infrastructure branches blocking).

**Resolution Options:**
1. Scope #1629's sentence: "a rubric that ran and found something" means a bound or unbound finding;
   `beyond` is the rubric's own verdict that the finding is outside the task, which #1629 never
   contemplated. Record the scoping in this feature's ADR and add the additive amendment note beside D8 in
   adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane in this spec change set.
2. Make beyond findings block until an operator accepts each one — defeats #1763 outcome 4 (zero
   operator interventions) and re-creates the exact babysitting the issue documents.
3. Supersede adr-2026-08-18's D8 with a new ADR — disproportionate; D8's decision (reduced coverage
   never suppresses a finding) stands unchanged.

**Recommendation:** Option 1 — the two decisions are about different objects (an operator decision
on an un-run rubric vs a rubric's own verdict on a finding), so D8 stands; only its "exactly as
today" phrasing needs scoping. Accepted as degrading: D8's wording is scoped by an amendment note rather than rewritten.

## Examined overlaps found compatible

- **Story 1 vs #1750 Story 1** ("guards the union against widening into a spurious blocker on the
  shared land gate"): Story 1 adds a *separate* rung after `validateArtifactContent('plan')`, does
  not widen the protected-target union, and is land-only. Both directions hold. Sequencing: this
  feature rebases on #1750 (shared `plan-task-parse.ts`); no circularity.
- **Story 4 vs adr-2026-08-18-rebase D6** ("No such counter is cleared by a `build_review` PASS"):
  Story 4 says no counter *advances* on a beyond-only PASS; it clears nothing. Compatible.
- **Story 6 vs adr-012 / adr-2026-08-12-intake-ledger** (ledger is the sole dedup authority on
  `source+sourceRef`): Story 5's per-finding-id record and the ledger agree because the record's
  `sourceRef` carries the finding id; Story 6's negative path "ledger refuses a second issue → record
  marked filed with the existing issue" makes the ledger the authority when they disagree.
- **Story 3 vs Story 2 / Story 7** (unresolvable binding rejects the envelope; tasks with no
  criteria yield empty evidence): a rubric facing empty evidence emits unbound findings (Story 7),
  never a binding, so Story 3's rejection path cannot fire on a no-criteria task. Both directions hold.
- **Story 1 vs the 300 merged plans without criteria**: land-only scoping (Story 1 last negative
  path) keeps them dispatchable; Story 7 keeps their review behavior unchanged. No state conflict.

## Oscillation scan

Every pair sharing the effective verdict, the disposition store, the land gate, the kickback
counters, or the intake ledger was asked "if A is fully satisfied, does B still hold?" in both
directions. No pair returned two "no" answers.
