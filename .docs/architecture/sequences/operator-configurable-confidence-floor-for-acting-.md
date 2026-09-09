# Sequence: a sub-floor finding is suppressed and a settled finding skips the judge

**Last updated:** 2026-09-07
**Scope:** Two consecutive build_review laps for one feature. Lap one shows a sub-floor finding
suppressed at the effective verdict and a surviving finding adjudicated and deferred. Lap two shows
the deferred finding recurring by exact id and finalizing without a remediate dispatch. Companion to
`.docs/architecture/operator-configurable-confidence-floor-for-acting-.md`.

## Diagram

```mermaid
sequenceDiagram
  autonumber
  participant G as Rubric grader
  participant P as finding parser
  participant E as effective reducer
  participant CFG as build_review.rubrics.«id».min_confidence
  participant S as Event spine
  participant CO as AdjudicationCoordinator
  participant ST as RemediationCaseStore
  participant J as remediate provider session

  Note over G,J: Lap one
  G->>P: findings A (confidence 30) and B (confidence 90)
  P->>P: range-check each confidence, absent allowed
  P-->>E: judged result, verdict FAIL
  E->>CFG: read floor («70»)
  E->>E: A below floor, bucket suppressed. B at or above, bucket unresolved
  E->>S: build_review_outer_verdict with suppressedFindings [A, 30, floor 70]
  E->>ST: persistBuildReviewSuppressions, upsert A by finding id (runs before the pass/fail fork)
  E-->>CO: effective FAIL, unresolved [B], suppressed [A]
  CO->>ST: read prior cases
  CO->>CO: live sources = [B] (A excluded, no finalized case for B)
  CO->>J: judge(context with B only)
  J-->>CO: case-v1, B is defer
  CO->>ST: persist B as deferral case, effect applied
  CO-->>E: route PASS, all findings have finalized non-action outcomes

  Note over G,J: Lap two, B recurs with the same content-anchored id
  G->>P: findings A (confidence 30) and B (confidence 90)
  P-->>E: judged result, verdict FAIL
  E->>E: A suppressed again, B unresolved
  E->>ST: persistBuildReviewSuppressions, A's entry refreshed in place to lap two
  E-->>CO: effective FAIL, unresolved [B]
  CO->>ST: read prior cases
  ST-->>CO: B binds by exact id to a finalized deferral case
  CO->>CO: live sources = [] after settled-recurrence predicate
  CO->>S: remediation_adjudication_completed, settled case ids, no new effects
  CO-->>E: finalize from durable state, route PASS, no dispatch
```

## Legend

- **The suppression path.** A is dropped from the blocking set before build_review fails on it and
  never reaches the coordinator; it is visible on the spine, and the effective reducer's own seam
  persists its durable entry immediately afterwards. That seam — not the coordinator — is why a
  lap whose findings are ALL sub-floor still leaves history: such a lap is an effective PASS that
  never reaches `CO` at all. On a mixed lap the coordinator re-runs the same idempotent upsert, so
  the two writes leave one row.
- **The adjudication steps are today's**, reduced to the surviving finding only.
- **The lap-two steps are the settled-recurrence fast-path.** The store already links B's exact id
  to a finalized deferral, so the predicate empties the live set and the lap finalizes without
  paying a provider session. The skipped dispatch is recorded as a completed adjudication.
- **Had B's id drifted on lap two**, it would not bind, the live set would be [B], and the judge
  would run — that is the intended boundary of the predicate.
- **Had A carried no confidence**, it would sit in unresolved and block like any other finding.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | Authored during DECIDE for jstoup111/ai-conductor#2383 |
| 2026-09-06 | Rewritten for grader-side confidence and the settled-recurrence predicate | Operator revised the placement |
| 2026-09-07 | Added the effective reducer's suppression-persistence seam on both laps; step-number references replaced by names | As-built review AB-1: the coordinator was the only writer, so a fully suppressed lap left no durable entry |
