# Conflict Check: Per-feature step applicability (#1789)

**Date:** 2026-10-03
**Stories:** .docs/stories/step-applicability-is-fixed-repo-wide-decide-canno.md (Stories 1-11)
**ADR corpus:** repo_wide (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASS after resolution — 3 blocking resolved, 0 blocking remaining; 2 degrading accepted.

## Corpus

- **ADRs:** 643 files in `.docs/decisions/` examined in full by delegated sweep, with no keyword
  narrowing.
- **Skipped as unambiguously fully superseded:**
  - adr-2026-07-03-gated-writeback-announcements
  - adr-2026-07-21-completeness-as-build-review-rubric
  - adr-2026-07-30-finish-only-mergeability-gate
  - adr-2026-08-12-removal-anchored-tautology-exemption
  - adr-2026-08-15-verify-only-anchored-tautology-exemption
  - adr-2026-08-16-preservation-anchored-completeness-exemption
  - adr-2026-08-29-build-review-remediate-case-adjudication
  - adr-2026-08-29-operator-authorized-kickback-budget-recovery
- **Stories:** about 535 files grepped broadly, and 32 candidate files read in their relevant story
  blocks.
- **Prior conflict reports reviewed for recurring patterns.** The recurring pattern is invariant
  stories of the form "the skip set is unchanged by X".

## Conflict: prd_audit is mandated on every feature

**Stories involved:** Story 4 (declarability) vs ADR prd-audit-stories-authority D2 and build-review-re-judges Story 7
**Files:** [.docs/stories/step-applicability-is-fixed-repo-wide-decide-canno.md] vs [.docs/decisions/adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "`prd_audit` runs on every feature, every tier, every track. `skippableForTracks` is removed; `configDisableAllowed` stays the only skip."
**Story opposing sentence (verbatim):** "Given the built-in step catalog, when declarability is queried for each step, then exactly coverage_binding, acceptance_specs, manual_test, prd_audit, and architecture_review_as_built report declarable."

**Description:** A per-feature declaration would be a second skip for a step that the ADR says has
exactly one.

**Resolution Options:**
1. Remove prd_audit from the declarable set.
2. Amend the ADR's D2 additively, and edit the foreign story through a companion PR.

**Resolution (operator):** Option 1. The operator agreed that removal stories still carry
surviving-behavior criteria for prd_audit to grade. Story 4 was replaced in place, and ADR D3 now
lists prd_audit as never declarable.

## Conflict: as-built review is mandated on every feature

**Stories involved:** Story 4 and Story 11 vs ADR as-built-review-runs-always D1/D4 and build-review-re-judges Story 12
**Files:** [.docs/stories/step-applicability-is-fixed-repo-wide-decide-canno.md] vs [.docs/decisions/adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-22-as-built-review-runs-always-with-plan-gap
**Story ID:** Story 11
**ADR opposing sentence (verbatim):** "The step runs on every feature; `skippableForTiers` and `skipWhenSkipped` are removed."
**Story opposing sentence (verbatim):** "Given architecture_review_as_built declared inapplicable and skipped, when rebase and finish run, then neither halts or fails for the missing as-built verdict."

**Description:** Declaring the as-built review inapplicable contradicts its every-feature mandate.
A deletion can still violate an APPROVED ADR, which is exactly what this review catches.

**Resolution Options:**
1. Remove architecture_review_as_built from the declarable set.
2. Amend the ADR's D1 and D4 additively, and edit the foreign story through a companion PR.

**Resolution (operator):** Option 1. Stories 4 and 11 were replaced in place, and ADR D3 was revised.

## Conflict: coverage_binding's model-free layers must always run

**Stories involved:** Story 4, Story 8, and Story 11 vs ADR coverage-binding-judge-step D16-D19, plan-slice-manifest D6, post-plan-decide-amendments Stories 1-2, and plans-cannot-declare-ordered-slices Story 7
**Files:** [.docs/stories/step-applicability-is-fixed-repo-wide-decide-canno.md] vs [.docs/decisions/adr-2026-08-31-coverage-binding-judge-step.md]
**Type:** state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-09-29-plan-slice-manifest
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "**When it runs:** before the judge, whatever the judge's enabled key says, at every tier."
**Story opposing sentence (verbatim):** "Given the built-in step catalog, when declarability is queried for each step, then exactly coverage_binding, acceptance_specs, manual_test, prd_audit, and architecture_review_as_built report declarable."

**Description:** Skipping coverage_binding would silently drop:
- ADR-obligation refusal;
- slice validation and membership recording;
- the forced re-run after a reseal.

A reseal void that returns the step to pending would also be re-honored, which could loop.

**Resolution Options:**
1. Remove coverage_binding from the declarable set.
2. Make the skip judge-only and keep the model-free layers running.

**Resolution (operator default, unopposed):** Option 1. Story 11 now asserts that the obligation and
slice layers still run.

## Degrading conflicts folded into the design

The design was amended for each of these before landing; none is a remaining conflict:

- **Event sink registry totality.** Both the ignored and the refused event get sink rows, and the
  metrics listener exports all three events (ADR D8).
- **Project-only config key.** Precedence follows the user-level config rules; the key is registered
  in the config-consumer registry (ADR D2; Story 1).
- **Bot-authored spec PRs.** The decider records both author and committer, and is an audit label
  only (ADR D6; Story 10).
- **Invalid base marker.** It is ignored with cause `invalid`, which covers the gap left by the
  decide-preseed presence-only discovery rule (ADR D5; Story 7).
- **Interactive-run ignored cause.** This was an internal inconsistency between ADR D5 and Story 7.
  Interactive runs now emit cause `interactive`.
- **Rebase, rewind, and post-rebase invalidation.** An already-honored step stays skipped and is
  never refused (ADR D7; Story 8).
- **Parallel validation group.** A declared manual_test is absent from dispatched members (ADR D8;
  Story 6).
- **Conduct-state mutation port.** All writes to `feature_inapplicable` go through it (ADR D8).
- **Zero-spec acceptance_specs contract.** An honored declaration is a skip, not a third completion
  outcome (ADR D3).
- **Stale ADR premise.** Preseeding is only `worktree` and `memory` (ADR Context, per
  adr-2026-08-03-fail-closed-decide-entry D2).
- **Protected-artifact seal.** The marker is deliberately unsealed because the base-only read is the
  authority (ADR D5).

## Accepted degrading conflicts

- **manual_test lock history.** adr-2026-07-06-manual-test-fail-routing first locked manual_test,
  #1777 then made it repository-disableable, and it is now also per-feature declarable. Accepted:
  the false-ship safeguard is replaced by the operator's spec-PR merge plus a mandatory reason. The
  step remains tier-invariant (adr-2026-07-21 D4), because a declaration is not a tier skip.
- **One owner per review question.** adr-2026-08-22-one-owner-per-review-question assigns "does it
  actually work?" to manual_test. Accepted: an honored declaration vacates that question for one
  feature, as the existing repository-wide disable already does for every feature.

## Re-check

After resolution, every story pair that shares a step, gate, or marker was re-tested in both
directions against the narrowed set. No contradiction, overlap, state, resource, sequencing, or
oscillating conflict remains blocking.
