# ADR: The as-built architecture review runs always, with per-check policy and a PLAN_GAP verdict
**Date:** 2026-08-22
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1805
**Amends:** adr-2026-07-13-kickback-build-no-op-escalation, adr-2026-07-21-s-tier-pipeline-knobs, adr-2026-07-10-validation-group-join, adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence

## Context

`architecture_review_as_built` skips S-tier and any feature whose DECIDE review was skipped
(`steps.ts:250-254`), yet two of its three checks (reachability, design-is-the-limit) need no ADRs.
Retiring `rootCause` leaves one residue: code that faithfully implements the approved design while
the design does not close the defect — an architecture judgement.

## Options Considered

### Option A: Residue into prd_audit
- **Cons:** prd_audit judging mechanism re-creates the overlap.

### Option B: Keep the skip; add PLAN_GAP only on M/L
- **Cons:** S-tier features can be green-but-unwired and plan-gapped just as easily.

### Option C: Run always; condition checks on artifact presence (chosen)

## Decision

1. The step runs on every feature; `skippableForTiers` and `skipWhenSkipped` are removed.
   Per-check defaults: reachability sweep — all tiers; PLAN_GAP check — all tiers; ADR compliance —
   whenever APPROVED ADRs exist (empty corpus passes, per adr-2026-08-09-adr-layer-gated-by-committed-adr-signal);
   diagram drift — where diagrams exist. Each check is operator-configurable per tier.
2. Verdicts: `APPROVED | APPROVED WITH DRIFT NOTES | PLAN_GAP | BLOCKED`. `PLAN_GAP` = the code
   matches the approved design and the design is the limit. With acceptance criteria passing it is
   recorded (verdict + shipped record) and the feature ships; when a stated outcome is undelivered it
   halts (class `plan-gap`). The gate parser is fail-closed as today; `PLAN_GAP` is recognized.
3. The as-built review **never kicks back to BUILD**. The as-built→build route and its capture/check
   pair in adr-2026-07-13-kickback-build-no-op-escalation are retired; prd_audit's route remains
   under that ADR's no-op escalation.
4. The S-tier pinned gate set (adr-2026-07-21 D4) is updated to include this step.

## Consequences

### Positive
- The rootCause residue has a home with no competitor; S-tier gains the reachability guard.

### Negative
- One more SHIP dispatch on S-tier; a PLAN_GAP halt costs a full operator decision.

### Follow-up Actions
- [ ] Step registry + per-check config; parser accepts PLAN_GAP; skill §12 updated.
