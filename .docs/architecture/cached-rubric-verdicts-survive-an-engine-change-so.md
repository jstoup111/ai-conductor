# Components: build_review rubric cache with engine identity (#1759)

**Last updated:** 2026-08-21
**Scope:** The build_review semantic cache path and the engine identity that must match before a cached rubric verdict is replayed. Planned state (approach C).

## Diagram

```mermaid
graph TD
  subgraph StepRunner["step-runners.ts — build_review step"]
    SR[runBuildReview]
    EID[resolveEngineIdentity «new»<br/>engineVersionId + per-rubric skill digest]
  end

  subgraph Identity["Identity sources"]
    EV[engine-version-id.ts<br/>versionIdFromEngineDir]
    SK[skills/build-review-«rubric»/SKILL.md<br/>sha256 of text]
    REG[build-review-registry.ts<br/>fingerprintBuildReviewRubricPolicy]
    PRJ[build-review-projections.ts<br/>projectionDigest]
  end

  subgraph Coord["build-review-coordinator.ts"]
    CO[coordinateBuildReviewRubrics]
    CL[classifyBuildReviewCacheLookup<br/>build-review-cache.ts]
  end

  CACHE[(".pipeline/build-review/cache/«rubric».json<br/>+ engineIdentity «new»")]
  MODEL[dispatchModel → grader session]
  EMIT[ConductorEventEmitter<br/>build_review_cache_hit<br/>build_review_cache_discarded «new»]
  SINK[(events.jsonl / daemon.log)]

  SR --> EID
  EV --> EID
  SK --> EID
  EID --> CO
  REG --> CO
  PRJ --> CO
  SR --> CO
  CO --> CL
  CACHE --> CL
  CL -- hit: same projection, policy, engine identity --> EMIT
  CL -- miss: engine-version-mismatch / skill-digest-mismatch --> EMIT
  CL -- miss --> MODEL
  MODEL -- judged result + engineIdentity --> CACHE
  EMIT --> SINK
```

## Legend

- «new» marks components or fields introduced by this feature; everything else exists today.
- The cache identity becomes: rubric, contractVersion, projectionVersion, projectionDigest, policyFingerprint, **engineIdentity**. A mismatch on any part is a miss; the two new miss reasons carry their own names so the log distinguishes an engine-change discard from an ordinary projection miss.
- Legacy entries without `engineIdentity` miss closed (`invalid-entry`), matching how v1/v2 contract entries already behave.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-21 | Initial generation | DECIDE for #1759, engineer loop |
| 2026-08-21 | Plan update: unreadable SKILL.md settles as existing `cache-read-failed` (no new reason); identity resolved in step-runners and injected | /plan for #1759 |
