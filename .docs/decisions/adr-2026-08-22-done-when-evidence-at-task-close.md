# ADR: Done when: checks are evidenced at BUILD task close when the block exists
**Date:** 2026-08-22
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1805
**Amends:** adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-07-22-per-task-work-happened-floor, adr-2026-07-21-demote-task-stamping-to-telemetry, adr-2026-07-05-engine-owned-task-status, adr-2026-07-17-verify-only-judged-closure, adr-2026-07-21-no-diff-task-evidence-stamp

## Context

#1764 made every plan task carry a `Done when:` block, gated at land only (adr-2026-08-21 D1):
300 of 301 merged plans lack it. No engine module reads the block. Earlier ADRs rejected a blocking
per-task *trailer* floor and demoted mechanical task stamping to telemetry because trailer
discipline produced false blocks.

## Options Considered

### Option A: Keep Done when: as land-gate-only prose
- **Cons:** per-task delivery has no owner once completeness is retired.

### Option B: Blocking per-task gate on every plan
- **Cons:** blocks the legacy corpus; the rejected shape of adr-2026-07-22.

### Option C: Evidence required only where the block exists (chosen)

## Decision

1. When a task has a `Done when:` block, the engine records per-check evidence (`Done-when:` lines
   in the task-close record, one per enumerated check) before marking the task `completed`; the
   write is engine-owned on the task-status record (adr-2026-07-05 H1/H4).
2. A task without the block closes on the prior evidence rule, unchanged — the legacy corpus keeps
   building. Verify-only and `Evidence: skipped` closures satisfy a check by their existing
   prove-closed path.
3. A check that cannot be made true under the approved plan is a `plan-gap` HALT from BUILD; it is
   never repaired off-plan and never appends a task.
4. This is a criteria floor on opted-in plans, not a trailer floor: adr-2026-07-22's rejection of a
   blocking trailer floor stands; adr-2026-07-21's demotion of stamping to telemetry stands.

## Consequences

### Positive
- BUILD evidences what the plan said would be true; test-quality scoping can bind to `task:<id>`.

### Negative
- New engine parser for the block (`plan-task-parse.ts` home) and a new halt class.

### Follow-up Actions
- [ ] Parser, task-close evidence write, plan-gap HALT.
