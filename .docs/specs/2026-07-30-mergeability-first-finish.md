# PRD: Mergeability-first daemon finish

**Date:** 2026-07-30
**Status:** Approved
**Supersedes:** The ancestry-freshness portions of
`.docs/specs/2026-06-25-phase-9.0-rebase-on-latest.md` FR-1, FR-2, FR-3, and FR-4. That PRD's
base-resolution, actual-rebase recovery, invalidation, HALT, resume, and observability requirements
remain authoritative.

## Problem / Background

The daemon currently treats base freshness as a finish requirement. When the target branch advances,
an otherwise mergeable feature is automatically rebased before publication. That rewrites feature
history, creates avoidable integration work, and can delay a branch that could already merge cleanly.

Operators care primarily that completed work can merge promptly. Freshness is valuable only when
base drift actually prevents a clean merge; it should not force history rewriting by itself.

## Goals & Non-Goals

**Goals**

- Preserve completed feature history when the feature can merge cleanly into its resolved target.
- Recover automatically when base drift creates a real merge conflict.
- Apply the mergeability-first decision at normal finish, where merge readiness is the goal.
- Keep the decision deterministic, fast, and independent of an external hosting service.

**Non-Goals**

- Eliminate operator-requested rebases.
- Change how conflicts are resolved after automatic recovery begins.
- Guarantee that a hosting platform will accept a merge despite unrelated policy checks such as CI,
  reviews, or branch protection.
- Change the behavior of already-paused rebases.

## Users / Personas

- **Daemon operator:** wants completed feature branches to remain stable and become merge-ready with
  minimal intervention.
- **Feature reviewer:** wants a reviewable branch whose history is not rewritten solely because the
  target branch advanced.

## Functional Requirements

- **FR-1:** Before automatically rewriting feature history to integrate an advanced resolved target
  branch, the daemon must determine whether the feature and target can merge cleanly without changing
  the feature branch.
- **FR-2:** When that prospective merge is clean, the daemon must leave feature commits and working
  state unchanged and treat the integration gate as satisfied even when the feature does not contain
  every target-branch commit.
- **FR-3:** A clean prospective merge that skips history rewriting must not invalidate or re-run
  downstream verification solely because the target branch advanced.
- **FR-4:** When the prospective merge reports conflicts, the daemon must automatically enter the
  existing rebase and bounded conflict-resolution flow.
- **FR-5:** When prospective mergeability cannot be determined reliably, the daemon must fail closed
  by entering the existing rebase flow rather than claiming the branch is mergeable.
- **FR-6:** Re-kick play-forward must retain its mandatory rebase onto the advanced base before
  retrying the pending gate; a mergeability-based skip applies only at normal finish.
- **FR-7:** A mergeability-based skip must not modify, translate, or rebaseline protected decision
  artifacts or their evidence because feature history did not move.
- **FR-8:** Operators must receive a distinct observable outcome when history rewriting was skipped
  because the feature was mergeable, separate from “already current,” “rebased,” and
  “conflict recovery required.”
- **FR-9:** An already-active or paused rebase must retain its existing fail-closed recovery behavior;
  the mergeability-first decision must never classify an incomplete rebase as safe to finish.

## Non-Functional Requirements

- The mergeability decision must run locally and must not require network or hosting-platform
  availability.
- The decision must not mutate the feature branch, index, working tree, or commit history.
- An indeterminate result must never be interpreted as a clean merge.

## Acceptance Criteria / Success Metrics

- A feature behind its target branch but prospectively mergeable finishes without commit rewrites.
- The same feature does not re-run downstream gates solely due to target-branch advancement.
- A feature with a prospective merge conflict automatically enters the existing recovery flow.
- An unavailable or inconclusive mergeability result also enters recovery.
- Finish-time clean mergeability skips history rewriting, while re-kick still incorporates the
  advanced base before retrying its pending gate.
- Tests prove that the mergeability assessment itself leaves branch, index, worktree, and history
  unchanged.
- Operator-visible evidence distinguishes every terminal decision listed in FR-8.

## Scope

### In Scope

- Mergeability-first behavior for automatic daemon integration at normal finish.
- Deterministic outcome classification and operator-visible evidence.
- Preservation of existing automatic conflict recovery.
- Canonical daemon and recovery documentation updates.

### Out of Scope

- Hosted-platform merge policy, CI, required reviews, or branch protection.
- New operator configuration or opt-out switches.
- Changes to manual interactive rebase behavior.
- Changes to re-kick’s mandatory play-forward integration contract.
- Redesign of the existing conflict resolver or post-publication mergeability sweep.
- Automatic pushing or force-pushing of rewritten branches.

## Key Decisions & Rationale

- Mergeability, not target-branch ancestry, is the automatic finish criterion because the operator’s
  priority is prompt merging without unnecessary history churn.
- Conflicts still trigger automatic recovery so the feature does not merely trade routine rebases
  for additional operator intervention.
- Indeterminate results enter recovery because a false clean classification could publish work that
  cannot merge.
- Re-kick remains freshness-driven because its purpose is to bring a potentially unblocking base
  commit into the feature before retrying a halted gate; mergeability-first skipping applies only
  where the goal is publication readiness.

## Dependencies

- An installed Git version capable of evaluating a prospective merge without mutating the working
  repository.
- The existing daemon rebase and bounded conflict-resolution behavior.

## Open Questions

- Architecture review must choose the finish-only prospective-merge seam and define its structured
  result contract without weakening re-kick play-forward or fail-closed behavior.
- Architecture review must decide whether the new “mergeable skip” outcome extends the existing
  integration outcome type or is represented as a separate gate decision.

## Verify-Claims Ledger — PRD — 2026-07-30

### Claims

- [verified] Automatic integration currently runs at normal finish and before re-kick resume, but
  re-kick specifically exists to incorporate the advanced base before retry — read the production
  call sites and approved re-kick requirements.
- [verified] A local, non-mutating prospective merge capability is available in the repository’s
  installed Git.
- [verified] Actual conflict recovery already has a bounded automatic resolution path.

### Assumptions

- [load-bearing] A clean prospective merge is sufficient for automatic finish even when the feature
  is behind its target branch.
  - **Status: APPROVED by operator 2026-07-30**
- [load-bearing] A reported or indeterminate conflict condition should enter automatic recovery.
  - **Status: APPROVED by operator 2026-07-30**
- [load-bearing] Mergeability skipping applies only at normal finish; re-kick retains mandatory
  play-forward rebase.
  - **Status: APPROVED by operator during conflict resolution on 2026-07-30**

### Verdict

CLEAR
