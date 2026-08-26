# Sequence: build_review lap publication on a contract-rejected rubric

**Last updated:** 2026-08-21
**Scope:** The build_review lap join and completion path when one rubric's judged result is
rejected after its repair turn (a mechanical fault) while the other rubrics judged clean —
showing where the current lap's aggregate is published, how the rejected rubric's concern is
preserved, and how completion distinguishes the current lap from a prior lap's aggregate.
Feature: `one-rubric-s-rejected-contract-discards-the-whole-` (#1740).

## Diagram

```mermaid
sequenceDiagram
    participant C as conductor.ts<br/>retry / kickback routing
    participant R as step-runners.ts<br/>build_review lap join
    participant D as dispatchBuildReviewRubric<br/>validate-and-repair
    participant A as build-review-aggregate.ts<br/>joinBuildReviewRubricOutcomes
    participant F as .pipeline/build-review.json<br/>(lap aggregate)
    participant L as kickback-ledger.ts<br/>mechanical-fault lane
    participant E as build-review-effective.ts<br/>effective resolver
    participant X as artifacts.ts<br/>build_review completion
    participant V as ConductorEventEmitter

    C->>R: run build_review for lap «lapId» = head sha
    R->>D: dispatch 4 rubrics (fan-out)
    D-->>R: completeness, rootCause, tautology: judged PASS (0 findings)
    D-->>R: scope: dispatch-failure after repair<br/>(bounded raw-output excerpt in detail)
    R->>R: scope becomes infrastructure-failure<br/>reason=invalid-provider-result, detail=excerpt
    R->>L: bumpMechanicalFaults(build_review)
    Note over R,L: CHANGED — the ledger entry now records<br/>lastMechanicalFault {rubric, reason, bounded detail, lapId}
    Note over R,F: UNCHANGED (adr-2026-08-18 D3) — below the cap<br/>no aggregate is published for this lap
    R->>V: build_review_rubric_infrastructure_failure «lapId» scope + excerpt
    R-->>C: success=false, currentLapMechanicalFault=true,<br/>output names scope + excerpt
    C->>L: faults below cap? re-run build_review (no kickback budget consumed)
    C->>X: completion check before next dispatch
    X->>F: read aggregate
    Note over X: CHANGED — a non-PASS aggregate whose lapId differs from<br/>the current lap is routeClass=absent, never a FAIL kickback.<br/>PASS keeps the code-stamp preservation path (adr-2026-07-22)
    alt aggregate.lapId == current lap and effective FAIL with judged findings
        X-->>C: done=false, named-route kickback to build<br/>reasons from THIS lap only
    else aggregate.lapId != current lap and verdict != PASS
        X-->>C: done=false, routeClass=absent, staleLap names both lap ids
        C->>V: build_review_stale_aggregate «storedLapId» vs «currentLapId»
    end
```

## Legend

- **Mechanical fault** — a rubric whose provider output never satisfied the judged contract
  (after one repair turn) or whose branch artifact is unreadable; recorded as
  `infrastructure-failure`, never as a reviewer verdict.
- **Allowance cap** — `MAX_MECHANICAL_FAULTS_BUILD_REVIEW` in `kickback-ledger.ts`; the
  mechanical lane re-dispatches build_review without consuming the build kickback budget.
- **CHANGED notes** mark the seams this feature alters: (1) the ledger entry carries a first-class
  record of the last mechanical fault; (2) completion compares a non-PASS aggregate's stored `lapId`
  to the current lap instead of relying on mtime freshness alone, and the stale condition is emitted
  on the spine. The lap join's no-publish rule (`adr-2026-08-18` D3) is deliberately unchanged.
- `«…»` are placeholders for runtime values.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-21 | Initial generation | #1740 — stale prior-lap aggregate replayed fixed findings; rejected rubric's concern lost |
| 2026-08-21 | Plan update: conform to adr-2026-08-18 D3 (no aggregate on a below-cap fault); ledger record + completion guard + spine event | architecture-review resolved the D3 conflict in favour of A′ |
