# Halt record

Status: halted
Slug: plans-that-contradict-sealed-story-criteria-or-app
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-plans-that-contradict-sealed-story-criteria-or-app
Head SHA: 25a874e355aa120225c89a5517dfdee56ad3f135
Halted at: 2026-10-03T22:15:28.151Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: AB-1 (REMEDIABLE; plan task 6): Verified (97%): coverage-binding-batches.ts:160 adds a conflict-claim branch to planCoverageBindingBatches, but its sole production caller passes only criterion and amendment claims. Conflict claims use the separate planConflictBatches path, leaving the Task 6 branch unreachable.; AB-2 (REMEDIABLE; adr-2026-08-31-coverage-binding-judge-step decision 21): Verified (98%): step-runners.ts:4618 resolves stories by corpus/feature stem through resolveFeatureStoriesPath instead of using the plan's normalized **Stories:** reference required by D21. A custom-named stories artifact can be skipped, and resolver failure also suppresses subject-ADR claims.; AB-3 (DESIGN; adr-2026-08-31-coverage-binding-judge-step decision 21): Verified conflict between approved decisions: D21 requires every subject-ADR path, including a branch-changed uncited ADR, to join post-rebase and finish inputs; adr-2026-07-20-post-rebase-delta-aware-invalidation D1 explicitly says an uncited ADR is not an input. rebase.ts:1276-1288 implements cited-only resolution, so no implementation can satisfy both clauses without a human architectural decision.

Blocking findings:
AB-1 (REMEDIABLE; plan task 6): Verified (97%): coverage-binding-batches.ts:160 adds a conflict-claim branch to planCoverageBindingBatches, but its sole production caller passes only criterion and amendment claims. Conflict claims use the separate planConflictBatches path, leaving the Task 6 branch unreachable.; AB-2 (REMEDIABLE; adr-2026-08-31-coverage-binding-judge-step decision 21): Verified (98%): step-runners.ts:4618 resolves stories by corpus/feature stem through resolveFeatureStoriesPath instead of using the plan's normalized **Stories:** reference required by D21. A custom-named stories artifact can be skipped, and resolver failure also suppresses subject-ADR claims.; AB-3 (DESIGN; adr-2026-08-31-coverage-binding-judge-step decision 21): Verified conflict between approved decisions: D21 requires every subject-ADR path, including a branch-changed uncited ADR, to join post-rebase and finish inputs; adr-2026-07-20-post-rebase-delta-aware-invalidation D1 explicitly says an uncited ADR is not an input. rebase.ts:1276-1288 implements cited-only resolution, so no implementation can satisfy both clauses without a human architectural decision.
```
