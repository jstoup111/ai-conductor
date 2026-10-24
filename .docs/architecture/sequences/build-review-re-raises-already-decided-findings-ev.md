# Sequence: a later build_review lap judges only the unsettled delta

**Last updated:** 2026-10-24
**Scope:** One build_review lap after a repair, for jstoup111/ai-conductor#3294. It shows how the
scope is decided, how a rubric judges the delta, how out-of-delta findings are admitted, and how
repair provenance joins the #3124 lineage.

## Diagram

```mermaid
sequenceDiagram
  participant SR as step-runners (build_review lap)
  participant FR as review frontier (new)
  participant ART as lap branch artifacts
  participant CS as remediation case store
  participant RB as rubric (each enabled)
  participant AG as aggregate / effective verdict
  participant RJ as remediate judge
  participant CO as adjudication coordinator
  participant EV as event spine

  SR->>FR: frozen snapshot hunks and mergeBase
  FR->>ART: read reviewScope of prior laps
  FR->>CS: read finalized source links
  alt first lap, mergeBase changed, version change, or unreadable record
    FR-->>SR: scope full (reason)
  else
    FR-->>SR: scope delta: unsettled hunks + repair provenance
  end
  SR->>EV: build_review_review_scope (mode, reason, counts)
  SR->>RB: projection: full changedFiles as reference + reviewScope
  RB-->>SR: findings, an out-of-delta finding names causeHunk
  SR->>ART: write branch artifact with reviewScope record
  SR->>AG: findings + delta
  AG->>AG: causeHunk outside the delta, or missing on a settled anchor → outOfDelta advisory
  AG->>EV: build_review_outer_verdict (+ outOfDelta count)
  alt unresolved findings in the delta
    SR->>RJ: current findings + prior cases (source summaries, locations)
    RJ-->>CO: case-v2 judgement
    CO->>CO: act case anchored in a repair-changed hunk → recurrenceOf that repair's case unless distinctFrom
    CO->>CS: reconcile, lineage limit 3 halts only at exhaustion
  else none
    SR-->>SR: build_review passes
  end
```

## Legend

- **Settled** means a hunk was reviewed by an earlier lap and every finding on it reached a
  finalized case: defer, reject, refute, advisory, merged, carried, or a resolved act. A changed
  hunk has a new content hash, so it is never settled.
- **Repair provenance** maps each delta hunk to the act cases applied since the predecessor lap that
  have a source anchored on the same path. It does not use commit trailers, which are telemetry
  only (#773).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial sequence | #3294 lap-monotonic build_review scope |
