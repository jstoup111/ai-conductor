# Sequence: sub-floor action demoted to a filed deferral

**Last updated:** 2026-09-06
**Scope:** One build_review lap in which the adjudicator returns an `act` case whose confidence is
below `build_review.adjudication.act_min_confidence`. Covers the demotion, the single filing, the
spine record, and the resulting route. Companion to
`.docs/architecture/operator-configurable-confidence-floor-for-acting-.md`.

## Diagram

```mermaid
sequenceDiagram
  autonumber
  participant C as Conductor
  participant CO as AdjudicationCoordinator
  participant P as remediate provider session
  participant A as remediation-case-artifact
  participant CFG as config build_review.adjudication
  participant R as case reconciler + effects
  participant GH as GitHub Issues
  participant S as Event spine
  participant RD as reduceBuildReviewAdjudication

  C->>CO: coordinate lap «lapId»
  CO->>P: judge(context)
  P-->>CO: case-v1 result
  CO->>A: readRemediationCaseJudgement
  A->>A: validate confidence is integer 0-100
  alt confidence out of range or not an integer
    A-->>CO: reject invalid-case-confidence
    CO-->>C: fail closed, lap halts
  else valid
    A-->>CO: judgement with case «caseRef» act, confidence «n»
  end
  CO->>CFG: read act_min_confidence («floor»)
  alt «n» at or above «floor»
    CO->>R: persist as action case (unchanged path)
  else «n» below «floor», tracker deps absent
    CO->>R: persist as action case, floor inert
    CO->>S: emit demotion-skipped reason
  else «n» below «floor», tracker deps present
    CO->>CO: synthesize deferral title, body, exclusionRationale
    CO->>R: persist as deferral case, not an action case
    CO->>S: emit remediation event with demotion reason
    R->>GH: fileIntakeIssue via Story 8 dedup marker
    GH-->>R: issueUrl (filed once, repeat lap reuses the marker)
    R-->>CO: deferral effect applied
  end
  CO->>RD: reduce over finalized case state
  alt no build-eligible action case survives and mechanical healthy
    RD-->>CO: route PASS, all findings have non-action outcomes
    CO-->>C: build_review done, no kickback charged
  else an action case survives
    RD-->>CO: route BUILD
    CO-->>C: kickback to BUILD for the surviving actions
  end
  CO-->>C: trace lists every demoted case with its confidence and the floor
```

## Legend

- **Steps 1-9 are unchanged** from the #2087 adjudication flow apart from the range check the
  artifact reader now performs on `confidence`.
- **The three-way alt is the whole feature.** At or above the floor nothing changes; below the
  floor with no tracker the floor is deliberately inert so a lap can never be halted by a deferral
  that cannot finalize; below the floor with a tracker the case becomes a deferral before it is
  persisted.
- **A demoted case charges no kickback and dispatches no BUILD work**, because it never becomes a
  build-eligible action case in the reducer's view.
- **Nothing is silently dropped.** Every demotion is visible three ways: the filed deferral issue,
  the spine event carrying the demotion reason, and the per-lap adjudication trace that reaches
  kickback and HALT evidence.
- **«floor»** is `build_review.adjudication.act_min_confidence`, default `0`, at which the
  comparison never fires and behavior is identical to today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | Authored during DECIDE for jstoup111/ai-conductor#2383 |
