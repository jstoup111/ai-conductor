# Sequence: a minor finding is advisory and a downgraded finding stays advisory

**Last updated:** 2026-10-19
**Scope:** Two consecutive build_review laps for one feature, with
`build_review.rubrics.implementationQuality.min_severity: major`.

- **Lap one:** a minor finding is classified advisory by the threshold. A major finding is
  adjudicated and downgraded to advisory.
- **Lap two:** both findings recur by exact id and the lap finalizes with no remediate dispatch.

Companion to `.docs/architecture/build-review-findings-carry-a-severity-with-a-per-.md`.

## Diagram

```mermaid
sequenceDiagram
  autonumber
  participant G as Rubric grader
  participant P as finding parser
  participant E as effective reducer
  participant CFG as rubrics.«id».min_severity
  participant S as Event spine
  participant CO as AdjudicationCoordinator
  participant ST as RemediationCaseStore
  participant J as remediate provider session
  participant PR as PR body publication

  Note over G,PR: Lap one
  G->>P: A (minor, confidence 96), B (major, confidence 90)
  P->>P: severity required and in closed enum
  P-->>E: judged result v4, verdict FAIL
  E->>CFG: read threshold («major») and confidence floor
  E->>E: A below threshold, bucket advisory. B unresolved
  E->>S: build_review_outer_verdict with advisoryFindings [A, minor, threshold major]
  E->>ST: persist advisory entry for A by finding id (before the pass/fail fork)
  E-->>CO: effective FAIL, unresolved [B], advisory [A]
  CO->>CO: live sources = [B]
  CO->>J: judge(context with B, advisory history non-blocking)
  J-->>CO: B is advisory, rationale "settled by plan task 4"
  CO->>ST: persist B case as advisory, effect none
  CO-->>E: route PASS, no BUILD, no kickback charged

  Note over G,PR: Lap two, A and B recur with the same ids
  G->>P: A (minor), B (major)
  P-->>E: judged result v4, verdict FAIL
  E->>E: A advisory again, B unresolved
  E->>ST: refresh A's advisory entry in place
  E-->>CO: effective FAIL, unresolved [B]
  ST-->>CO: B binds by exact id to a finalized advisory case
  CO->>CO: live sources = [] (settled-recurrence predicate)
  CO->>S: remediation_adjudication_completed, no dispatch, no effects
  CO-->>E: route PASS

  Note over G,PR: Finish
  ST-->>PR: advisory entries A and downgraded case B
  PR->>PR: render Advisory build-review findings region
```

## Legend

- **Threshold advisory (A)** never reaches the coordinator, is never judged, and never charges the
  kickback budget. It appears on the spine, in durable history, in the CLI and on the PR.
- **Adjudicator advisory (B)** costs one remediate dispatch, the same as a defer does today. Once
  finalized, the settled-recurrence predicate keeps it from being re-judged while its id is stable.
- **Had B's id drifted**, it would be a live source again and the judge would run. Id drift is #3294
  and is out of scope here.
- **With no `min_severity` configured**, A would be unresolved and both findings would reach the
  judge, as they do today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | Authored during DECIDE for jstoup111/ai-conductor#3298 |
