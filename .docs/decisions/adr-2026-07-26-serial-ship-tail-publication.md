# ADR: Serialize SHIP validation, rebase, and publication

**Date:** 2026-07-26
**Status:** SUPERSEDED by `adr-2026-07-26-rebase-tail-current-branch-before-publication` (operator-approved 2026-07-26)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#922)
**Related:** adr-2026-07-10-validation-group-join

## Context

`finish` publishes or updates a feature PR. The current dependency graph permits it after
`rebase`, while `prd_audit` and `architecture_review_as_built` can still be incomplete,
stale, or failed. This exposes an externally visible PR before the SHIP validation verdict is
known. Running rebase concurrently with the validation tail adds no useful publication latency
benefit: a file-changing rebase invalidates affected evidence and returns the loop to
re-validation.

## Options Considered

### Option A: Make finish depend on both rebase and the validation tail
- **Pros:** Stops finish from running before validation.
- **Cons:** Keeps rebase concurrent with validation and retains a wider SHIP-tail execution graph.

### Option B: Add a dedicated validation/publish join step
- **Pros:** Names the synchronization point explicitly and could support future publishers.
- **Cons:** Adds new state, completion, and scheduling behavior that duplicates existing step dependencies.

### Option C: Serialize validation, rebase, and finish
- **Pros:** One dependency change establishes an unambiguous publication order; a rebase cannot race
  validation and any changed rebase naturally returns through the existing invalidation loop.
- **Cons:** Rebase starts after validation rather than overlapping it.

## Decision

Choose Option C. The SHIP tail runs validation through `retro`, then rebase, then finish. The
implementation changes `rebase` to depend on `retro`; `finish` continues to depend on `rebase`.
No new join or publication step is introduced.

## Consequences

### Positive
- PR publication follows all applicable SHIP validation and a rebase of that validated branch.
- The ordering is expressed in the existing step registry and remains easy to inspect and test.

### Negative
- Rebase no longer overlaps validator execution, increasing successful-tail wall-clock time by one
  rebase duration.

### Follow-up Actions
- [ ] Update the `rebase` prerequisite and its rationale in `steps.ts`.
- [ ] Add gate and integration coverage for validation → rebase → finish ordering and changed-rebase revalidation.
