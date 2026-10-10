# Conflict Check: ADRs carry a machine-checked assumption ledger (#542)

**Date:** 2026-10-10
**New stories:** `.docs/stories/adrs-lock-without-a-machine-checkable-assumption-l.md` (Stories 1-5)
**ADR corpus mode:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASSED, with 0 blocking conflicts and 1 degrading overlap (operator decision below)

## Inventory and narrowing

All 575 stories files were searched for the surfaces these stories touch: the land ADR rung, the
`architecture_review` step and its enforcement or skip behavior, `GATE_ONLY_PREDICATES`, the ADR
template, verify-claims ledger practice, and daemon-discovery ADR checks. The pairs that share a
behavior, entity, or gate with the new stories were read and tested in both directions:

| Existing story | Shared surface | A satisfied → B holds? | B satisfied → A holds? | Outcome |
|---|---|---|---|---|
| `adr-approval-gate-before-build` Story 3 (land refuses unapproved ADR corpus) | land ADR rung | yes | **literal no** (see Conflict 1) | degrading overlap |
| `adr-approval-gate-before-build` Story 5 (discovery refuses unapproved corpus) | discovery ADR check | yes, since approval at discovery is unchanged | yes, since new Story 3 pins that discovery ignores ledgers | clean |
| `reaped-stale-claim-jstoup111-ai-conductor-2054` Story 3 (land citability rung, diff-scoped) | land ADR rung, diff scoping | yes, as the rungs are independent and both diff-scoped | yes | clean |
| `reaped-stale-claim-jstoup111-ai-conductor-2054` Story 4 (template names decision forms; examples inert) | `adr.md.template` | yes, because the new section is separate from `## Decision` and the status vocabulary | yes, because an ADR authored per the guidance fills the ledger (new Story 5) | clean |
| `features/architecture-review/ST-017-architecture-review` (DRAFT ADRs block before BUILD) | ADR approval lifecycle | yes | yes | clean |
| `accepted-stories-are-never-checked-against-the-eng` (`GATE_ONLY_PREDICATES.stories` routes through the shared predicate) | `GATE_ONLY_PREDICATES` | yes, as a separate map entry | yes | clean |
| `s-tier-pipeline-knobs` (`getSkippableSteps('S')` includes `architecture_review`) | `architecture_review` tier skip | yes, because new Story 4 keeps `skippableForTiers: ['S']` | yes | clean |
| `parallel-validation-phase-fan-out-manual-test-prd-` (as-built still runs when DECIDE architecture_review skipped) | `architecture_review` skip | yes, since the as-built gate is untouched | yes | clean |
| `implementation-only-remediation-falsely-requires-d` / `daemon-mode-route-halt-user-input-required-through` (`architecture_review` as a remediation or kickback target) | `architecture_review` re-entry | yes. A remediation lap that adds an ADR is held to the same ledger, and one that adds none passes (new Story 4, daemon-shaped case) | yes | clean |

No oscillating pair was found. No gate in the new stories is a precondition for a gate that, in turn,
re-breaks it.

**ADRs examined (narrowed by subject overlap from the repo-wide corpus):**
adr-2026-08-08-single-adr-approval-parser-three-rungs,
adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition,
adr-2026-09-02-adr-decision-citability-contract,
adr-2026-08-23-criterion-layer-is-structural-at-land,
adr-2026-06-29-architecture-before-stories-convergent-kickback,
adr-2026-08-13-markdown-default-inversion, adr-2026-08-24-evidentiary-defects-are-not-waivable,
adr-2026-08-22-one-owner-per-review-question, adr-2026-09-23-one-owner-for-accepted-story-readability,
adr-2026-10-10-adr-assumption-ledger-contract.
None contradicts a new story. adr-2026-09-23 (land and `GATE_ONLY_PREDICATES` must share one
predicate, not two implementations) **reinforces** the design. The plan should route both rungs
through one shared in-scope-ADR evaluation, not only one shared parser.

**ADRs narrowed out:** every other `.docs/decisions/adr-*.md`, because its subject does not touch
ADR content gates, the land ADR rung, `architecture_review` enforcement, gate-only predicates, or the
ADR template. Keyword sweeps for `advisory` with `architecture_review`, and for
`GATE_ONLY_PREDICATES`, surfaced adr-2026-07-11, adr-2026-08-04, adr-2026-08-18, adr-2026-07-21,
adr-2026-08-31, adr-2026-07-06, and adr-2026-08-26. On reading, none governs `architecture_review`
enforcement or ADR content, so all were narrowed out.

## Conflict 1: "ADR gate passes" literal outcome vs a new ledger refusal

**Stories involved:** Story 3 "A spec cannot be landed while any ADR is unapproved" vs Story 3
"Composer land refuses a spec whose new ADR lacks a valid ledger"
**Files:** `.docs/stories/adr-approval-gate-before-build.md` vs
`.docs/stories/adrs-lock-without-a-machine-checkable-assumption-l.md`
**Type:** overlap
**Severity:** degrading

**Description:** The older story's happy path reads "Given a worktree whose ADRs all declare an
allowlisted status, when `land` runs, then the ADR gate passes and the land proceeds." Read
literally, an all-APPROVED worktree whose new ADR lacks a ledger must land, while the new Story 3
refuses it. The older story's subject is the approval rung (`adrApprovalStatus`), and the same
literal tension already exists with the citability rung landed under #2054, which refuses
all-APPROVED worktrees with an uncitable new ADR. No implementation is blocked: the approval rung
still passes on that worktree; only a separate rung refuses.

**Resolution Options:**
1. Accept as degrading with no story edit: read "the ADR gate" in the older story as the approval
   rung, as the citability precedent already does.
2. Edit the older shipped story to say "the ADR approval rung passes".
3. Add a cross-reference in the new Story 3 naming the older story's approval-rung scope.

**Recommendation:** Option 1. The older story is a shipped feature's acceptance record, the citability
precedent already established the reading, and editing shipped stories outside their own feature
adds churn without changing behavior.

## Operator decision

Conflict 1: Option 1 accepted by the operator on 2026-10-10 (degrading, no story edit).
