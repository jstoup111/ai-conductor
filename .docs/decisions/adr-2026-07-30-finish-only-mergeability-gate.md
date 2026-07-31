# ADR: Limit mergeability-first skipping to normal finish

**Date:** 2026-07-30
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session
**Supersedes:** `adr-2026-07-30-mergeability-first-integration-gate`
**Amends:** `adr-2026-07-26-rebase-tail-current-branch-before-publication`

## Context

The superseded ADR placed prospective mergeability inside the rebase primitive shared by normal
finish and re-kick. Conflict-check found that these callers have different product purposes:

- normal finish needs a branch that can merge promptly, so ancestry freshness is unnecessary when a
  prospective merge is clean;
- re-kick runs after base advancement because a new base commit may unblock a previously failed gate,
  so that commit must enter the feature worktree before the gate retries.

A shared mergeable-skip would make re-kick retry the gate on unchanged feature content and could
repeat the same HALT.

## Options Considered

### Option A: Finish-only mergeability gate

Run the prospective merge assessment only from normal finish. Preserve re-kick’s mandatory
play-forward rebase.

**Pros:** Directly serves each caller’s purpose; avoids routine publication rebases; preserves
re-kick recovery; smallest behavioral change.

**Cons:** The two callers no longer share one top-level integration policy, though they continue to
share actual rebase and conflict-resolution machinery.

### Option B: Shared mergeability gate

Keep the superseded ADR.

**Pros:** One policy and one insertion point.

**Cons:** Re-kick can omit the base commit that was supposed to unblock its pending gate. Rejected.

### Option C: Gate-specific base-impact analysis

Before re-kick, decide whether advanced-base commits affect the pending gate’s inputs.

**Pros:** Could avoid some re-kick rebases.

**Cons:** Requires trustworthy dependency surfaces for heterogeneous judged gates and introduces a
new false-negative risk. Disproportionate to the operator’s finish-time goal.

## Decision

Adopt Option A.

Normal finish:

1. Preserve the active/incomplete-rebase guard.
2. Resolve the current default/base target.
3. Preserve the already-current no-op.
4. If behind, evaluate the prospective merge without changing refs, index, worktree, or history.
5. Clean → return a distinct mergeable-skip result, preserve downstream verdicts, and avoid
   rebase-only evidence translation and protected-seal rebaselining.
6. Conflict or indeterminate → enter the existing rebase and bounded resolution flow.

Re-kick:

1. Preserve its existing mandatory play-forward rebase onto the advanced base.
2. Do not run or accept mergeable-skip.
3. Continue sharing the existing rebase driver, conflict resolver, verdict, evidence translation,
   protected-seal, and HALT machinery with finish.

The engine-native lifecycle step retains its existing name and placement. At normal finish its
satisfied predicate becomes “already current or prospectively mergeable”; at re-kick the existing
“rebased onto advanced base” contract remains.

## Consequences

### Positive

- Routine finish-time base advances do not rewrite mergeable feature history.
- Re-kick still imports potentially unblocking commits before gate retry.
- Existing actual-rebase safety and recovery machinery remains shared.
- No new external integration or configuration is introduced.

### Negative

- The finish caller needs an explicit policy option or separate wrapper around the shared rebase
  primitive; caller intent can no longer be inferred solely from repository state.
- Finish and re-kick require distinct integration tests to prevent policy leakage.

### Follow-up Actions

- [ ] Add an explicit finish-only mergeability policy at the production call boundary.
- [ ] Prove re-kick cannot return mergeable-skip and still rebases before pending-gate retry.
- [ ] Preserve actual-rebase conflict, seal, evidence, and invalidation behavior for both callers.
- [ ] Update operator documentation to distinguish finish readiness from re-kick play-forward.
